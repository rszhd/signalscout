import { type DestinationStream, pino } from "pino";

export type Logger = ReturnType<typeof pino>;

/**
 * Field names that must never appear in a log line with their value.
 *
 * US-004's failure shape, from docs/testing.md, is "a key reaches a log line
 * or an API response". Nothing in this repository logs a credential today, and
 * this list is the guard for the line somebody adds next year while debugging
 * a connector at 02:00: pino replaces the value before it is serialised, so
 * the mistake produces `[redacted]` rather than a key in a container log.
 *
 * The wildcards cover one level of nesting, which is the shape credentials
 * actually arrive in — `{ credentials: { apiKey } }` from a source, and the
 * `err.*` copy pino makes of a thrown error's own fields.
 *
 * `secrets/leak.test.ts` asserts this, because a list nothing checks is a list
 * that drifts from the field names the code uses.
 */
export const redactedFields = [
  "apiKey",
  "apiSecret",
  "credentials",
  "password",
  "token",
  "ENCRYPTION_KEY",
  "*.apiKey",
  "*.apiSecret",
  "*.credentials",
  "*.password",
  "*.token",
  "*.ENCRYPTION_KEY",
];

export interface LoggerOptions {
  level: string;
  name: string;
  /**
   * Where the lines go. Defaults to stdout.
   *
   * A test that asserts what a job logged needs to read the lines, and reading
   * them is the only way to keep "every job logs its monitor id, duration and
   * outcome" a check rather than a claim.
   */
  destination?: DestinationStream;
}

export function createLogger({ level, name, destination }: LoggerOptions): Logger {
  const options = { level, name, redact: { paths: redactedFields, censor: "[redacted]" } };

  return destination ? pino(options, destination) : pino(options);
}
