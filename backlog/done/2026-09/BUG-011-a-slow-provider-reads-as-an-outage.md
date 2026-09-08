---
id: BUG-011
title: A slow provider reads as an outage
type: bug
priority: p1
created: 2026-09-08T12:45+08:00
parent:
area:
resolution: fixed
---

## Context

Reported from a running instance: testing a ScrapeCreators key on the
connections screen failed.

It was not the key, and it was not the provider. **Node gives each address a
hostname resolves to 250 milliseconds to connect before moving to the next**,
and fails the request with `ETIMEDOUT` when they are exhausted.
`api.scrapecreators.com` completes a TLS connection in **850 to 1,200
milliseconds** from here, so Node gave up before the connection finished —
about half the time, at a consistent ~580ms, which is two 250ms attempts and
change.

The symptom is the worst kind this product can produce. A person pastes a
correct key, presses Test, and is told the provider could not be reached.
Pressing it again works. Nothing in the message points at the real cause, and
both things it does point at are innocent.

It is not specific to ScrapeCreators. Any provider slower than a quarter of a
second to connect — which is most of them from most places — has been failing
some fraction of its calls this whole time, in the worker as well as on the
screen, where it would have looked like a flaky provider.

`curl` never failed once under the same conditions, in about twenty attempts,
because it waits.

## Acceptance

- [x] A connect attempt gets longer than the slowest measured provider needs
- [x] Set once per process, at the start of both the API and the worker
- [x] A wrong key is refused with the provider's own words again, rather than
      reported as an outage
- [x] A test says what the number is for, so nobody tunes it back down

## Notes

- `net.ts` carries the measurement. The test asserts the budget exceeds the
  slowest observed connection, which is the assertion that stops somebody
  lowering it to "something reasonable" without re-measuring.
- Raising it costs nothing on a healthy call. The budget is only spent failing
  over between addresses, and a refused connection still fails immediately —
  that is a packet coming back rather than a timeout.

## Log

- 2026-09-08T12:45+08:00 — Reported by the owner: "scrapecreators test
  connection failed from UI".
- 2026-09-08T12:50+08:00 — Reproduced through the built app in one request:
  **502, "ScrapeCreators could not be reached"**, from a deliberately wrong key
  that should have been a 200 carrying `valid: false`.
- 2026-09-08T12:52+08:00 — Three wrong theories, discarded in order, and each
  one is worth recording because each looked right. **The provider's WAF blocks
  undici's user agent** — no: with no user agent at all it failed once and
  succeeded once. **A dead A record** — no: the host round-robins over at least
  four AWS addresses and `curl --resolve` reached every one of them.
  **My own sandbox** — no: it failed the same way with the sandbox disabled.
- 2026-09-08T12:56+08:00 — The number was the clue. Every failure was ~580ms and
  every success 780–1,280ms. A failure that consistent is a stopwatch, not a
  network. `net.getDefaultAutoSelectFamilyAttemptTimeout()` is **250**.
- 2026-09-08T12:58+08:00 — Confirmed: with the budget at 3,000ms, six of six
  succeeded. Fixed at 5,000ms and driven through the built app on the same
  route that failed — **six of six now answer 200 with the provider's own
  sentence**, "ScrapeCreators rejected the API key (Invalid API key)".
- 2026-09-08T13:02+08:00 — **A test that spends nothing cannot see this, and
  that is the lasting problem rather than the setting.** No test in this suite
  calls a provider, so a whole class of connection fault is invisible to a green
  run — this one had been shipping since the first connector. The `curl`
  comparison is what found it: same host, same machine, one client waits and the
  other does not.
