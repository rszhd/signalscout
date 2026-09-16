/**
 * One process-wide network setting, and the measurement behind it. BUG-011.
 *
 * Node races the addresses a hostname resolves to and gives each one
 * **250 milliseconds** to connect before moving to the next. When they are all
 * exhausted the request fails with `ETIMEDOUT` — a fast one, at about half a
 * second, which reads like a dead host rather than like a stopwatch running
 * out.
 *
 * That default is tuned for choosing between IPv6 and IPv4 on a local network.
 * It is far too short for a remote API: measured on 2026-09-08,
 * `api.scrapecreators.com` completes a TLS connection in **850 to 1,200
 * milliseconds** from here, so roughly half of all requests to it failed before
 * the connection had a chance to finish. `curl` never failed once in the same
 * conditions, because it waits.
 *
 * The symptom is the worst kind: a person pastes a correct key, presses Test,
 * and is told the provider could not be reached. Pressing it again works. The
 * key was never the problem and neither was the provider.
 *
 * **What raising it costs.** The budget is only spent failing over between
 * addresses, so the price is paid only when an address accepts a connection and
 * then goes silent — a blackholed route. A refused connection still fails
 * immediately, because that is a packet coming back rather than a timeout. For
 * a poller that runs on a schedule, waiting five seconds to discover a dead
 * route is not a cost worth optimising against a provider we cannot reach at
 * all.
 */
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

/**
 * Five seconds, against Node's 250 milliseconds.
 *
 * Chosen from the measurement above with room to spare: the slowest connection
 * observed was 1.2 seconds, and a provider having a bad minute should not turn
 * into "your key is wrong".
 */
export const connectAttemptTimeoutMs = 5_000;

/**
 * Set it, once, at the start of a process that talks to providers.
 *
 * Called by `startApi` and `startWorker` rather than run as an import side
 * effect: a module that changes global network behaviour by being loaded is a
 * module nobody can import to read a constant.
 */
export function configureNetworking(): void {
  setDefaultAutoSelectFamilyAttemptTimeout(connectAttemptTimeoutMs);
}
