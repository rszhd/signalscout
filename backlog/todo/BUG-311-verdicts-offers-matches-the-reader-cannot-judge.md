---
id: BUG-311
issue: 64
title: pnpm verdicts offers matches the reader cannot judge
type: bug
priority: p2
created: 2026-09-22T21:40+08:00
parent: US-309
area: tooling
resolution:
---

## Context

`scripts/verdicts.mjs` reads `matches` and `feedback` across the whole
instance. Neither query scopes to an account. A match belongs to a monitor,
a monitor belongs to a user, and a verdict is one person's answer — so
mixing them is wrong in both directions.

It cost an hour on 2026-09-22. `--sample=40` listed X, TikTok, LinkedIn and
YouTube matches owned by test accounts, and the owner went looking for them
in an inbox that could never show them. The analysis was correct by luck:
only one account had given any verdicts, so nothing was mixed.

The analysis is the more dangerous half. A second account judging anything
would silently pool two people's answers into one distribution and the
script would report it as a result.

## Acceptance

- [ ] Both queries join through `monitors.user_id` and scope to one account.
- [ ] `--user=<email>` names it. Absent, and with exactly one account holding
      monitors, that one is used. Absent with several, it exits 2 and lists
      the accounts rather than guessing.
- [ ] Every run prints which account it reports on, in the first line.
- [ ] `--sample` prints the inbox link for each match —
      `/projects/<projectId>/matches/<matchId>` — not only the platform URL.
      A list a reader cannot act on is what caused this.
- [ ] The Log records a run proving a second account's verdicts do not reach
      the first account's numbers.

## Notes

- `exportFeedback` in `packages/pipeline/src/feedback/feedback.ts` already
  takes a `userId`. The script should have followed it.
- The base URL for the inbox link needs a flag or an environment variable;
  `WEB_PORT` is in `.env` and the dev server's origin is not the same as a
  deployed one.

## Log

- 2026-09-22T21:40+08:00 — Found while judging for US-033. The sample sent the owner after matches on four platforms that belong to other accounts, and their own account holds Reddit only.
