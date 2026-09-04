import { createLogger, type Logger } from "../logger.js";
import type { SourceRuntime } from "./types.js";

/**
 * The runtime a connector gets in production. Every field is overridable,
 * because a test that reaches Reddit or X is a test that spends money.
 */
export function createSourceRuntime(overrides: Partial<SourceRuntime> = {}): SourceRuntime {
  return {
    fetch: overrides.fetch ?? globalThis.fetch,
    now: overrides.now ?? (() => new Date()),
    sleep: overrides.sleep ?? realSleep,
    logger: overrides.logger ?? defaultLogger(),
  };
}

function realSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

let fallbackLogger: Logger | undefined;

function defaultLogger(): Logger {
  fallbackLogger ??= createLogger({ level: "info", name: "sources" });
  return fallbackLogger;
}
