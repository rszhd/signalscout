---
id: US-149
title: A figure shown to an account is money spent on its own keys
type: bug
priority: p1
created: 2026-09-16T10:40+08:00
parent: US-141
area: core
resolution: fixed
---

## Context

**The owner switched an account to its own keys and saw a cost at once.** It
was the trial's spend on the instance's keys — not the account's money, and
US-133 had only hidden it while the account was on ours. The moment the
account switched, every reader summed the whole ledger.

**The ledger already knows who paid.** US-141 stamped every `api_usage` and
`model_calls` row with `key_source`, so the account fuse could count the
instance's half alone. The readers on the other side — a monitor's spend, the
budget guard, the pricing page — never used it.

**So a reader counts the rows stamped with the key source the account is on
now.** No caller changes, no mode threaded through eleven call sites: the
condition sits on the row, comparing `key_source` with the account's state,
which is `instance` where no row exists. A self-hosted instance therefore
counts everything, as before. An account on its own keys sees and is capped
by its own money alone. The fuse is unchanged; it counts the other half.

## Acceptance

- [x] `readSpend` and `spendByPair` count only rows whose `key_source` is the
      account's current one, in SQL, with no caller changed
- [x] A row stamped `instance` is not counted for an account on `own`, and a
      row stamped `own` is not counted for an account on `instance`
- [x] An account with no `account_key_source` row counts its `instance` rows,
      which is every self-hosted instance
- [x] `docs/costs.md` says which rows a figure is made of

## Notes

Switching back and forth counts each period's rows on its own keys again;
that is the account's money and is right to show.

## Log

- 2026-09-16T10:55+08:00 — Fixed. One condition on the row in three queries; the
  budget test covers no row, `own`, and the cap. Not rendered in a browser.
