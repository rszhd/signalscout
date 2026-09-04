/**
 * Where the worker gets the keys a connector needs, until US-004 encrypts them
 * in the database.
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
import type { SocialSource, SourceCredentials } from "../sources/types.js";

/** What the poll step calls to get one source's credentials. */
export type CredentialLookup = (source: SocialSource) => SourceCredentials | undefined;

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
