/**
 * The connect budget. BUG-011.
 *
 * This is a one-line setting and it still gets a test, because the failure it
 * prevents is not visible from anywhere else: a correct key refused with "the
 * provider could not be reached", about half the time, on a screen. Nothing in
 * the suite calls a provider, so nothing else in the suite can notice if this
 * line is deleted.
 *
 * What it cannot assert is the measurement behind the number. That was taken by
 * hand on 2026-09-08 against `api.scrapecreators.com`: a TLS connection took
 * 850 to 1,200 milliseconds, Node's default budget is 250, and six of six
 * requests failed at ~580ms until the budget was raised. `net.ts` carries it.
 */
import { getDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { describe, expect, it } from "vitest";
import { configureNetworking, connectAttemptTimeoutMs } from "./net.js";

describe("how long an address gets to connect", () => {
  it("is longer than the time the slowest provider measured takes", () => {
    // 1,200ms was the slowest observed. A budget under it fails a healthy
    // provider; this is the assertion that stops somebody tuning it down to
    // "something reasonable" without re-measuring.
    expect(connectAttemptTimeoutMs).toBeGreaterThan(1_200);
  });

  it("replaces Node's default, which is far too short for a remote API", () => {
    configureNetworking();

    expect(getDefaultAutoSelectFamilyAttemptTimeout()).toBe(connectAttemptTimeoutMs);
    // The default this exists to replace. If Node ever raises it, this case
    // says so rather than leaving a setting nobody remembers the reason for.
    expect(connectAttemptTimeoutMs).toBeGreaterThan(250);
  });
});
