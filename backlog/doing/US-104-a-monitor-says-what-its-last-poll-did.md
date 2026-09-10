---
id: US-104
title: A monitor says what its last poll did
type: feature
priority: p1
created: 2026-09-10T09:51+08:00
parent:
area: web
resolution:
---

## Context

**A monitor spent $0.666 on the production instance, collected nothing, and
the screen said `Running`.** On 2026-09-09 the first monitor on
app.signalscout.run polled fifteen times between 19:38 and 19:48 UTC. It billed
SocialCrawl 67 Reddit credits and 15 X credits. It stored **zero posts**, so
`collect.ts:551` returned early, no `filter` job was ever sent, and the inbox
stayed empty. The owner had no way to learn any of that. The monitor list read
`Running`, which was true and useless.

Everything needed to explain it was in the database and in the container logs,
and reaching it took an SSH key, `psql`, and a reading of `pgboss.job`. That is
the diagnosis path for the person who wrote the product. On the cloud version
there is no such path at all: a customer sees `Running` and an empty inbox, and
the only two readings available to them are "nobody is talking about this" and
"this product does not work". Both are wrong, and the second one is the one
they will pick.

**`status()` in `Monitors.tsx` answers a different question than the one being
asked.** It reports the four states a *person or a cap* can put a monitor in —
budget spent, needs a key, paused, running. None of them is about the poll. A
monitor whose every search returns nothing, whose provider refuses its key
mid-run, or whose parser drops every record, is `Running` in all three cases.

**The rows exist and nothing reads them.** `api_usage` holds the spend per
pair, `pgboss.job` holds the poll's start and finish, `posts` holds what came
back, `filter_drops` holds what the pre-filter cut, and `model_calls` holds
every answer and its outcome. What is missing is a record of the **poll as an
event**: which sources it asked, how many records each returned, how many were
new, what it spent, and why it stopped. That cannot be reconstructed afterwards
— a poll that collected fifty posts already held by another monitor and a poll
that collected nothing are the same absence of rows.

So this ticket writes one row per poll and puts it on the screen. It is a log
in the sense that matters to a person: what happened, when, and what it cost.

**The three numbers that separate the failure modes must be distinct.** The
production run needed *collected*, *new* and *units billed* to be told apart:
zero collected against spend says the searches or the parser are at fault; many
collected and zero new says deduplication is working and the monitor is asking
an old question; many new and zero matches says the threshold is wrong. One
"posts found" number collapses all three, which is what the screen has today.

**A poll's own errors are already logged and thrown away.** The container is
recreated on every deploy, so the log lines that would have explained the
production run were destroyed nine minutes after it finished. A skipped source
logs `poll skipped for this source: no provider for it has credentials
configured` at `error` and nothing sees it. Those reasons belong on the row.

## Acceptance

- [x] A table records one row per poll, per monitor: when it started and
      finished, and per source and provider the records returned, the posts
      stored new, the units billed and the estimated cost
- [x] A poll that stops for a reason records the reason — no credential, no
      provider choice, a switched-off connector, the budget cap, a provider
      refusal, a rate limit — and which source it stopped on
- [x] A poll that returns records and stores nothing new is distinguishable on
      the row from a poll that returned no records at all
- [x] `GET /api/monitors/:id/polls` answers with the account's own rows, most
      recent first, and 401 without a session and 404 for another account's
      monitor
- [x] The monitor list says when the last poll ran and what it did, in one
      line, without opening anything
- [x] A monitor whose last poll collected nothing does not read `Running`
      alone: the screen says the poll found nothing and when it will try again
- [x] Opening a monitor shows its recent polls, each with its counts, its
      spend and its stop reason
- [ ] The production run is reproducible against the recorded rows: a poll
      billing 82 credits for zero posts is legible on the screen without a
      database — **open: nothing has run live**
- [x] Rows are trimmed, so a monitor polling hourly for a year does not grow
      the table without bound

## Notes

- The row is written by `collect.ts` and it must be written on **every** exit,
  including the early return at line 551 and the budget refusal above it. A
  poll that records nothing when it does nothing is the bug this ticket is
  about, one layer down.
- `pgboss.job` is not the store. It is trimmed by pg-boss on its own schedule,
  it holds no per-source counts, and reading another library's table on a
  screen makes its retention policy our product's retention policy.
- Fifteen poll jobs ran for one collection. The chain is the paging walk
  resuming itself, so a *poll run* on the screen should be the walk and not
  the job — otherwise one collection reads as fifteen failures.
- Spend must stay an estimate in the words `docs/costs.md` uses. This screen
  adds a place where a number is shown to a person, and it is the fifth.
- The stop reason is a closed set, not free text. A sentence written at the
  call site cannot be counted, translated or tested, and this is the field a
  person will read first.
- Do not surface a provider's raw error. `logger.ts` redacts keys; a screen
  built from an exception message has no such rule.

## Log

- 2026-09-10T09:51+08:00 — Written after reading the production instance. The
  monitor `Test` on app.signalscout.run had polled fifteen times, billed
  $0.666, stored zero posts and reported `Running`. Why it collected nothing is
  a separate question and is not this ticket: the fault this one records is
  that answering it required SSH and `psql`. First written as US-103 at 04:31;
  that file was lost from the working tree and the number taken by another
  ticket, so it is re-filed here unchanged.
- 2026-09-10T10:22+08:00 — Built. `poll_runs` and migration 0056, applied to the
  development database. `collect.ts` records on seven of its eight exits; the
  eighth is the deleted monitor, which has nothing to attach a row to.
  `posts_new` is read from `xmax = 0` on the returning clause, which is the only
  way to tell an inserted row from a found one when `on conflict do update`
  returns both. `GET /api/monitors/:id/polls`, and `lastPoll` on every monitor.
  The screen says what the last poll did, and a monitor that found nothing reads
  `Found nothing` and joins the attention count while staying in the running
  count — it is active, and taking it out of that number would be a second lie.

  **1,820 tests pass**, 30 of them new. Thirteen deliberate mutations were
  applied and twelve turned the suite red the first time. The one that did not
  is worth keeping: `readPollRuns` has two locks — the monitor's owner and the
  owner on the row — and the scoping test could kill neither, because a poll
  writes both from the same person. Two rows a poll cannot produce were written
  by hand, each leaving one lock holding, and each mutation is caught now. **A
  guard nothing can reach is a guard nothing tests.**

  The last box is open and it is the one that matters: nothing has run live. No
  poll on a real machine has written a row, and the production monitor this
  ticket was written from is still the only evidence that any of it was needed.
- 2026-09-10T14:35+08:00 — Deployed to staging and then to production, which
  both run this build with `poll_runs` and `source_coverage` present. Rows have
  been written by a real poll against a real provider: `collected` with 125
  returned and 104 new at $0.0406, `page_cap` as the stop reason, and one
  `walk_id` across three polls of the same collection. So the table answers the
  question it was written for.

  The last box stays open on one word. Nobody has opened the monitor list on
  the production instance, so "legible on the screen" is still read from a
  database rather than from a screen.
