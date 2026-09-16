/**
 * Test helpers, reachable as `@signalscout/engine/testing`.
 *
 * `unreachableFetch` is how a connector's test proves it never reached the
 * network: the real `fetch` is replaced with one that throws. `silentLogger`
 * is a logger that writes nothing, for a test that wants the code's output
 * and not its narration.
 */
import { createLogger, type Logger } from "../logger.js";

export { unreachableFetch } from "./network.js";

export const silentLogger: Logger = createLogger({ level: "silent", name: "test" });
