import { describe, expect, it } from "vitest";
import { maximumRetryAfterSeconds, ProviderError, readAnswer, retryAfterDate } from "./core.js";

const now = new Date("2026-09-23T12:00:00.000Z");
const fallback = 60;

function secondsFrom(date: Date): number {
  return (date.getTime() - now.getTime()) / 1000;
}

describe("retryAfterDate", () => {
  it("reads a number of seconds", () => {
    expect(secondsFrom(retryAfterDate("30", now, fallback))).toBe(30);
  });

  it("rounds a fraction up, because waiting too little is the failure", () => {
    expect(secondsFrom(retryAfterDate("1.2", now, fallback))).toBe(2);
  });

  it("reads an HTTP date, which the header also allows", () => {
    expect(secondsFrom(retryAfterDate("Wed, 23 Sep 2026 12:02:00 GMT", now, fallback))).toBe(120);
  });

  it("never waits longer than the maximum, however long the provider asks for", () => {
    // BUG-324. A day's wait held back every platform of the monitor.
    expect(secondsFrom(retryAfterDate("86400", now, fallback))).toBe(maximumRetryAfterSeconds);
    expect(secondsFrom(retryAfterDate("Thu, 24 Sep 2026 12:00:00 GMT", now, fallback))).toBe(
      maximumRetryAfterSeconds,
    );
  });

  it("uses the fallback when the header says nothing it can use", () => {
    for (const header of [null, "", "soon", "0", "-5", "Tue, 22 Sep 2026 12:00:00 GMT"]) {
      expect(secondsFrom(retryAfterDate(header, now, fallback)), String(header)).toBe(fallback);
    }
  });
});

describe("readAnswer", () => {
  it("parses a JSON body and keeps the wait header", async () => {
    const answer = await readAnswer(
      new Response(JSON.stringify({ ok: true }), { status: 429, headers: { "retry-after": "5" } }),
    );

    expect(answer).toEqual({ httpStatus: 429, body: { ok: true }, retryAfterHeader: "5" });
  });

  it("keeps a body that is not JSON as text, because a refusal often is not", async () => {
    const answer = await readAnswer(new Response("Unauthorized", { status: 401 }));

    expect(answer).toEqual({ httpStatus: 401, body: "Unauthorized", retryAfterHeader: null });
  });
});

describe("ProviderError", () => {
  class ExampleError extends ProviderError<"credentials" | "rateLimit"> {}

  it("names itself after the subclass, so a log line says which provider", () => {
    const error = new ExampleError("rateLimit", "Slow down.", 429, now);

    expect(error.name).toBe("ExampleError");
    expect(error).toBeInstanceOf(ExampleError);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.retryAfter).toBe(now);
  });
});
