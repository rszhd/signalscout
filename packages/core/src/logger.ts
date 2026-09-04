import { type DestinationStream, pino } from "pino";

export type Logger = ReturnType<typeof pino>;

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
  return destination ? pino({ level, name }, destination) : pino({ level, name });
}
