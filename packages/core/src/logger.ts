import { pino } from "pino";

export type Logger = ReturnType<typeof pino>;

export function createLogger(options: { level: string; name: string }): Logger {
  return pino({ level: options.level, name: options.name });
}
