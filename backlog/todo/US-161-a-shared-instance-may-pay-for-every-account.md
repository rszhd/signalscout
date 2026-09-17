---
id: US-161
title: A shared instance may pay for every account's calls
type: feature
priority: p1
created: 2026-09-17T10:56+08:00
parent:
area: billing
---

## Context

SignalScout Cloud is moving to instance keys: the hosted product pays the
providers and the model, and a person who wants to bring their own keys
self-hosts this repository. The cloud plans are priced on that
(cloud US-164 to US-170).

Today the pipeline cannot express it. `config/machine-keys.ts` answers one
question — `machineKeysUsable(signup)` — and four callers in
`worker/runtime.ts` read the same answer for four different things:

1. whether a poll may use the machine's provider keys;
2. whether a model call may use the machine's model keys;
3. whether a webhook URL is guarded against our own network (US-097);
4. whether an account may sign deliveries with the machine's webhook
   secret (US-096).

On a shared instance that pays for its accounts, 1 and 2 become *yes* and 3
and 4 must stay *no*: a stranger's webhook URL is still a stranger's string,
and a signing secret every account shares is still forgeable. Flipping
`AUTH_SIGNUP` to `closed` on the cloud would open all four, which is why a
second axis is needed rather than a second value of the first.

## Acceptance

- [ ] The pipeline takes an explicit key policy, `keys: "account" |
      "instance"`, beside the signup mode. Neither is inferred from the other.
- [ ] With `instance`, a poll and every model job fall back to the keys in
      the environment for every account, and an account that pasted nothing
      still runs. With `account`, nothing changes from today.
- [ ] The webhook address guard and the webhook secret still follow the
      signup mode alone. A test proves an `open` + `instance` composition
      guards addresses and hands out no shared secret.
- [ ] A self-hosted `closed` instance keeps its default: `instance`. An
      `open` instance keeps its default: `account`. So no existing deployment
      changes behaviour without setting the new option.
- [ ] `docs/secrets.md`, *Whose key is it*, states the two axes.
- [ ] Released as a version the cloud can pin, with a `docs/releasing.md`
      note.

## Notes

- `packages/pipeline/src/config/machine-keys.ts`, and the four call sites in
  `packages/pipeline/src/worker/runtime.ts` (lines near 383, 423, 534, 550).
- `apps/api/src/server.ts` in this repository reads the same functions for
  its screens; the self-hosted app needs no new behaviour, only the default.

## Log

- 2026-09-17T10:56+08:00 — Written from the cloud costing study.
