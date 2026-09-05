/**
 * Where the worker gets the keys a connector needs.
 *
 * Two places, in order: the `source_credentials` table, and then the process
 * environment. US-004 added the first; the second is what every instance still
 * uses, and it stays, because a self-hoster with one set of keys should not
 * have to run a key-management step to poll Reddit.
 *
 * The order is what makes a stored credential worth storing: once a row
 * exists, it wins, and the environment variable behind it becomes the value
 * nobody edits any more.
 *
 * This is the one place the application reads an environment variable that
 * `config/env.ts` does not declare, and the reason is that the set of
 * variables is not known until the registry is built: it is one per credential
 * field per registered connector. The name is derived, never listed, so adding
 * a connector adds no case here.
 *
 *     <SOURCE ID>_<FIELD NAME>, upper snake case
 *     reddit + apiKey     -> REDDIT_API_KEY
 *     x      + apiSecret  -> X_API_SECRET
 *
 * The name is the *source*, not the provider behind it. A user connects
 * Reddit; that Reddit happens to arrive through Bright Data is a fact of
 * `sources/reddit/`, and STACK.md, *A source is not a provider*, keeps it
 * there. The field's own label already says whose key to paste.
 */
import type { Database } from "../db/client.js";
import type { Source } from "../db/schema.js";
import { type EncryptionKey, optionalEncryptionKey } from "../secrets/cipher.js";
import { credentialRecordName, readSourceCredential } from "../secrets/store.js";
import type { SourceCredentials, SourceDescriptor } from "../sources/types.js";

/**
 * What the poll step calls to get one source's credentials.
 *
 * It may answer synchronously or with a promise, and every caller awaits it.
 * The environment lookup needs no await and the store reads a row, and neither
 * should have to pretend to be the other.
 */
export type CredentialLookup = (
  source: SourceDescriptor,
) => Promise<SourceCredentials | undefined> | SourceCredentials | undefined;

/** `apiKey` -> `API_KEY`, `apiSecret` -> `API_SECRET`. */
function screamingSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toUpperCase();
}

export function environmentVariableFor(sourceId: string, fieldName: string): string {
  return `${screamingSnakeCase(sourceId)}_${screamingSnakeCase(fieldName)}`;
}

/**
 * Read one source's credentials from the environment.
 *
 * Returns `undefined` when any field is missing, rather than a half-filled
 * object. A poll with half a key is a failed API call, and a failed API call
 * retries four times before it dead-letters: four wrong answers to a question
 * we could answer here for nothing.
 */
export function credentialsFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): CredentialLookup {
  return (source) => {
    const credentials: Record<string, string> = {};

    for (const field of source.credentialFields) {
      const value = environment[environmentVariableFor(source.id, field.name)];
      if (!value) return undefined;
      credentials[field.name] = value;
    }

    return credentials;
  };
}

/** One credential a source needs and the environment does not hold. */
export interface MissingCredential {
  readonly sourceId: string;
  /** "Reddit", so the sentence a user reads names what they connected. */
  readonly sourceName: string;
  readonly field: string;
  /** The connector's own label: "Bright Data API key". */
  readonly label: string;
  readonly environmentVariable: string;
}

/**
 * Which of a source's credentials are not set, named the way a person can act
 * on.
 *
 * `credentialsFromEnvironment` answers "can this source run?" and deliberately
 * says nothing more, because a poll with half a key is simply a poll that must
 * not happen. US-010 asks the other question: a monitor that cannot start owes
 * the user the sentence that says why, and "check your credentials" is not
 * that sentence. Both read the same naming rule above, so neither can be right
 * about a variable the other is wrong about.
 */
export function missingCredentials(
  source: SourceDescriptor,
  environment: Record<string, string | undefined> = process.env,
  stored: ReadonlySet<string> = new Set(),
): MissingCredential[] {
  return source.credentialFields
    .filter(
      (field) =>
        !stored.has(credentialRecordName(source.id, field.name)) &&
        !environment[environmentVariableFor(source.id, field.name)],
    )
    .map((field) => ({
      sourceId: source.id,
      sourceName: source.displayName,
      field: field.name,
      label: field.label,
      environmentVariable: environmentVariableFor(source.id, field.name),
    }));
}

/**
 * The store first, then the environment, one field at a time.
 *
 * A source with two fields may have one in each place. That is not a shape
 * anybody should aim for, but refusing it would mean a half-migrated instance
 * cannot poll, and a poll that could have run is the more expensive mistake.
 *
 * Without an `ENCRYPTION_KEY` this is exactly `credentialsFromEnvironment`.
 * Nothing can be stored without a key, so there is nothing to read.
 */
export function credentialsFromStore(
  db: Database,
  key: EncryptionKey | undefined = optionalEncryptionKey(),
  environment: Record<string, string | undefined> = process.env,
): CredentialLookup {
  const fromEnvironment = credentialsFromEnvironment(environment);

  if (!key) return fromEnvironment;

  return async (source) => {
    const credentials: Record<string, string> = {};

    for (const field of source.credentialFields) {
      // A stored row that cannot be decrypted throws here rather than falling
      // through to the environment. Silently polling with the old key is how a
      // rotation looks like it worked.
      // The cast is safe by construction: `createSourceRegistry` refuses to
      // boot on an id that `posts.source` does not accept, so a descriptor
      // that reaches here is always one of them.
      const stored = await readSourceCredential(db, key, source.id as Source, field.name);
      const value = stored ?? environment[environmentVariableFor(source.id, field.name)];

      if (!value) return undefined;
      credentials[field.name] = value;
    }

    return credentials;
  };
}
