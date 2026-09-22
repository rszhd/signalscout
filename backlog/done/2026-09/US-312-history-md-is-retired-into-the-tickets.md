---
id: US-312
issue: 65
title: history.md is retired into the tickets that hold its evidence
type: chore
priority: p2
created: 2026-09-23T05:37+08:00
parent:
area: docs
resolution: shipped
---

## Context

`docs/history.md` is 32,000 words, the largest document in this repository,
and the owner's judgement on 2026-09-23 is that nobody reads it and the
tickets already track every decision.

**That was tested before it was accepted.** Twenty-six measurements were
taken from paragraphs that name no ticket — the ones most likely to be
orphaned — and every ticket file was searched for those exact numbers.
**Twenty-five of the twenty-six are already in a ticket. None was found only
in `history.md`.** It is a second copy, not a second source. Every ticket id
it names still has a file, so nothing it points at has been lost either.

What retiring it costs is the navigation: the file is organised by subject —
Pipeline, Sources, Model, Costs, Accounts — so it answers "why is this
threshold what it is" without knowing the ticket id. A ticket Log answers
that only if you already know where to look. That cost is real and is
accepted: it is navigation, not evidence, and 32,000 words is too much to
carry for it.

**This is a rewrite, not a delete.** Seventy references point at the file
from `AGENTS.md`, `README.md`, `PLAN.md`, `STACK.md`, `CHANGELOG.md`, six
`docs/` pages, four source files and `scripts/comment-density.mjs`. Several
were added on 2026-09-22 by US-302's comment rule, which says a measurement
belongs in `history.md`. That rule changes with this ticket.

## Acceptance

- [x] Every substantial paragraph is checked against the tickets, not
      sampled. Anything found **only** in `history.md` is moved into the Log
      of the ticket that earned it, before the file is removed. The count is
      recorded here.
- [x] `docs/history.md` is deleted.
- [x] All seventy references are rewritten to name the ticket that holds the
      evidence — `US-048's Log`, not `docs/history.md, *Sources*`. A
      reference with no identifiable ticket is a paragraph that failed the
      check above.
- [x] AGENTS.md's comment rule says a measurement stays in its ticket's Log.
      The two things a comment is not are unchanged.
- [x] `scripts/comment-density.mjs` and US-302's parked children stop naming
      the file.
- [x] README.md's repository table drops the row.
- [x] `pnpm lint`, `pnpm typecheck` and the suite pass. The diff is comments
      and documents; no behaviour moves.

## Notes

- The check is the expensive part and the only part that can lose something.
  Do it with a script that reports what it could not place, and read that
  list by hand rather than trusting a pass rate.
- `backlog/done/` holds 209 tickets; `history.md` names 109 of them. The 100
  it does not name are not a gap — it was always curated.

## Log

- 2026-09-23T05:37+08:00 — Written after the owner called the file redundant. The claim was tested before it was accepted: 25 of 26 orphan-looking measurements were already in a ticket and none was unique to the file. The earlier position in this session — that it is an index worth keeping — did not survive that evidence.
- 2026-09-23T05:37+08:00 — **Every paragraph checked, not sampled: 12 of 409 held something no ticket did.** A script split `history.md` into 471 paragraphs, 409 of them 25 words or longer, and pulled 1,332 checkable facts from those — every figure, price and percentage, and every code name. Each was searched for in the tickets the paragraph names and then in every ticket. 283 paragraphs were placed that way: all their facts in a ticket, most of them in one. 16 with no facts shared at least 30% of their wording with one ticket. The other 110 were read by hand against their nearest ticket: the 44 with a fact found nowhere, the 62 with no facts and little wording in common, and the 4 whose facts were spread thin. Code names found nowhere are in the code, which is where they live. Nine paragraphs were moved into the Log of the ticket that earned them: BUG-017 (an empty scoped Reddit search is free; the production monitor was paused by the owner at $1.06 of $5.00), US-005 (Bright Data's contract clauses), US-006 (what each provider says to a refused key), US-014 (the $164 plan against a $10 cap, and the same sample polled every minute), US-018 (about seventy-five deliberate mutations, twenty-three on the test-first surfaces), US-155 (what the split's migrations drop) and US-159 (the X reply endpoint found by asking). Three came from another project and no ticket here earned them; they are the next entry. Not moved, on purpose: the billing paragraphs, which the cloud repository's `docs/billing.md` holds whole; a per-post price column that is arithmetic on figures the tickets hold; and one illustrative figure, a monitor at $9.99 of a $10.00 cap. What the check cannot say: the 299 paragraphs placed by facts or wording were not read for a claim with no number in it.
- 2026-09-23T05:37+08:00 — **Carried from `history.md`, from another project.** docs/testing.md's rules were adopted from a project called patrol on 2026-09-04, and these three incidents came with them. **The in-memory Postgres fake**: that project ran one for a year and kept a list of its lies — a `bytea` parameter corrupted through a UTF-8 round trip so AES-GCM ciphertext never decrypted; `on conflict do nothing` reporting a row count of 1 for a conflicting insert; `count(*) filter (where …)` answering with the unfiltered count. The tax was never the lies on the list. It was the next one. **The broad catch**: a memory generator ended `except Exception: return None` under an honest promise, that a provider timeout must cost a run nothing. It reached the model through `asyncio.run` from inside an already running loop, raised on every call, returned `None` every time, and nothing went red. Twenty-four assertions covered the parts; none covered the one function the caller calls. **The least-tested caller**: four tickets in a row there shipped a correct rule that one caller never reached, with the assertion on the rule itself passing every time.
- 2026-09-23T05:37+08:00 — Deleted, and every reference outside `backlog/done/` rewritten: 23 in the documents, the four source files and the script, and 14 in US-232 and US-302's three parked children. The seventy counted when this was written included `backlog/done/`; those tickets name the file as it was when they closed, and a closed Log is not rewritten. US-232's 2026-09-19 entry keeps its mention for the same reason. Lint, typecheck and 2,312 tests in 130 files pass.
