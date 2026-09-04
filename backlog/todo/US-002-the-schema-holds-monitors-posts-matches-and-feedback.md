---
id: US-002
title: The schema holds monitors, posts, matches and feedback
type: feature
priority: p1
created: 2026-09-04
parent:
area:
resolution:
---

## Context

PLAN.md names four tables: monitors, posts, matches, feedback. They are the
vocabulary every later ticket uses, so they are settled once, here, rather
than grown one column at a time by whichever ticket needs them next.

Three columns exist for reasons the table names do not show, and each is
painful to add later.

**`UNIQUE (source, external_id)` on posts.** An X read costs $0.005. A bug
that re-reads a window is not a duplicate row problem; it is a charge on the
user's card. The constraint is the last defence when the cursor logic fails.

**`last_verified_at` on matches.** Reddit's terms require that content the
author removed stops being shown. A reconciliation job needs somewhere to
record what it checked. Adding the column later means backfilling a null over
every existing match and deciding what a null means.

**An embedding column on posts.** `pgvector` holds it, so the pre-filter has
no second database to query. It is nullable, because a post filtered out by
keyword never earns an embedding call.

A monitor stores the four answers from PLAN.md as written by the user, and
the generated queries separately. Keeping them apart means a query can be
regenerated when the prompt improves, without asking the user to retype
anything.

## Acceptance

- [ ] Drizzle schema and a first migration create monitors, posts, matches and
      feedback
- [ ] `posts` has `UNIQUE (source, external_id)`, and a test asserts an insert
      of a duplicate fails
- [ ] `posts` has a nullable `pgvector` embedding column
- [ ] `matches` has `last_verified_at` and a hidden flag
- [ ] `monitors` stores the user's four answers and the generated queries in
      separate columns
- [ ] `feedback` records one verdict per match per user, with the timestamp
- [ ] Migrations are plain SQL files, numbered, one number per file
- [ ] Migrations apply against an empty database and against one that already
      has them, without error

## Notes

- Depends on [US-001](US-001-the-workspace-runs-with-one-command.md).
- STACK.md, *What the economics add to the build*, for why the three columns
  above are correctness concerns and not features.
- One number, one migration file. Two branches that both take the next number
  merge cleanly and break at boot.
- Do not add a `status` column to anything the folder structure already says.

## Log

- 2026-09-04 — Written from PLAN.md and STACK.md.
