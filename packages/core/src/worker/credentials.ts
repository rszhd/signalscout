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
 *     <PROVIDER ID>_<FIELD NAME>, upper snake case
 *     brightdata + apiKey     -> BRIGHTDATA_API_KEY
 *     x-api      + apiSecret  -> X_API_API_SECRET
 *
 * The name is the *provider*, and US-024 changed it. It used to be the
 * platform, which was right while one provider served one platform: a user
 * connects Reddit, and that Reddit arrives through Bright Data. It is wrong
 * now. One Bright Data key serves Reddit, X and LinkedIn, so a platform-named
 * variable would have to be set three times to the same value, and a person
 * rotating that key would have three chances to leave one behind.
 *
 * `REDDIT_API_KEY` is still read, so an instance that is running keeps
 * running, and reading it logs that it is going. The README says so.
 */
import type { Database } from "../db/client.js";
import type { Provider } from "../db/schema.js";
import type { Logger } from "../logger.js";
import { type EncryptionKey, optionalEncryptionKey } from "../secrets/cipher.js";
import { credentialRecordName, readSourceCredential } from "../secrets/store.js";
import type { ConnectorDescriptor, SourceCredentials } from "../sources/types.js";

/**
 * What the poll step calls to get one source's credentials.
 *
 * It may answer synchronously or with a promise, and every caller awaits it.
 * The environment lookup needs no await and the store reads a row, and neither
 * should have to pretend to be the other.
 */
export type CredentialLookup = (
  connector: ConnectorDescriptor,
) => Promise<SourceCredentials | undefined> | SourceCredentials | undefined;

/** `apiKey` -> `API_KEY`, `apiSecret` -> `API_SECRET`. */
function screamingSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toUpperCase();
}

export function environmentVariableFor(providerId: string, fieldName: string): string {
  return `${screamingSnakeCase(providerId)}_${screamingSnakeCase(fieldName)}`;
}

/**
 * The name this field had before US-024, built from the platform.
 *
 * Read only when the provider's own variable is unset, so an instance that
 * upgraded without editing `.env` keeps polling. It is a fallback and not a
 * second supported name: reading it logs, once per process, which line to
 * change.
 */
export function deprecatedEnvironmentVariableFor(platformId: string, fieldName: string): string {
  return `${screamingSnakeCase(platformId)}_${screamingSnakeCase(fieldName)}`;
}

/**
 * Read one field from the environment, preferring the provider's name.
 *
 * Every reader goes through here, so the fallback cannot be honoured in one
 * place and forgotten in another — which would make a monitor that polls fine
 * report itself as missing a key.
 */
function environmentValue(
  connector: ConnectorDescriptor,
  fieldName: string,
  environment: Record<string, string | undefined>,
): { value: string; deprecated: string | null } | undefined {
  const current = environment[environmentVariableFor(connector.provider.id, fieldName)];
  if (current) return { value: current, deprecated: null };

  const old = deprecatedEnvironmentVariableFor(connector.platform.id, fieldName);
  const value = environment[old];

  return value ? { value, deprecated: old } : undefined;
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
  logger?: Logger,
): CredentialLookup {
  return (connector) => {
    const credentials: Record<string, string> = {};

    for (const field of connector.provider.credentialFields) {
      const found = environmentValue(connector, field.name, environment);
      if (!found) return undefined;

      if (found.deprecated) warnOnce(logger, found.deprecated, connector, field.name);
      credentials[field.name] = found.value;
    }

    return credentials;
  };
}

/**
 * Say once per variable that its name is going.
 *
 * Once, because this runs on every poll of every monitor. A line per poll is a
 * line nobody reads, and a deprecation nobody reads is a deprecation that
 * surprises somebody the day the fallback is removed.
 */
const warnedVariables = new Set<string>();

function warnOnce(
  logger: Logger | undefined,
  deprecated: string,
  connector: ConnectorDescriptor,
  fieldName: string,
): void {
  if (warnedVariables.has(deprecated)) return;
  warnedVariables.add(deprecated);

  logger?.warn(
    {
      deprecated,
      use: environmentVariableFor(connector.provider.id, fieldName),
      provider: connector.provider.id,
    },
    "this credential is named after the platform; the name after the provider replaces it",
  );
}

/** One credential a connector needs and this deployment does not hold. */
export interface MissingCredential {
  /** The platform. "reddit": what the monitor names and the person ticked. */
  readonly sourceId: string;
  /** "Reddit", so the sentence a user reads names what they connected. */
  readonly sourceName: string;
  /** The provider. "brightdata": whose account the key is on. */
  readonly providerId: string;
  /** "Bright Data", so the sentence names where to go and get one. */
  readonly providerName: string;
  readonly field: string;
  /** The provider's own label: "Bright Data API key". */
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
  connector: ConnectorDescriptor,
  environment: Record<string, string | undefined> = process.env,
  stored: ReadonlySet<string> = new Set(),
): MissingCredential[] {
  return connector.provider.credentialFields
    .filter(
      (field) =>
        !stored.has(credentialRecordName(connector.provider.id, field.name)) &&
        !environmentValue(connector, field.name, environment),
    )
    .map((field) => ({
      sourceId: connector.platform.id,
      sourceName: connector.platform.displayName,
      providerId: connector.provider.id,
      providerName: connector.provider.displayName,
      field: field.name,
      label: field.label,
      environmentVariable: environmentVariableFor(connector.provider.id, field.name),
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
  logger?: Logger,
): CredentialLookup {
  const fromEnvironment = credentialsFromEnvironment(environment, logger);

  if (!key) return fromEnvironment;

  return async (connector) => {
    const credentials: Record<string, string> = {};

    for (const field of connector.provider.credentialFields) {
      // A stored row that cannot be decrypted throws here rather than falling
      // through to the environment. Silently polling with the old key is how a
      // rotation looks like it worked.
      // The cast is safe by construction: a provider that reaches here was
      // registered, and `source_credentials.provider` accepts every registered
      // provider or the boot check would have refused the row.
      const stored = await readSourceCredential(
        db,
        key,
        connector.provider.id as Provider,
        field.name,
      );

      if (stored) {
        credentials[field.name] = stored;
        continue;
      }

      const found = environmentValue(connector, field.name, environment);
      if (!found) return undefined;

      if (found.deprecated) warnOnce(logger, found.deprecated, connector, field.name);
      credentials[field.name] = found.value;
    }

    return credentials;
  };
}
