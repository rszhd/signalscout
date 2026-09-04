---
id: US-002
title: The schema holds monitors, posts, matches and feedback
type: feature
priority: p1
created: 2026-09-04
parent:
area:
resolution: shipped
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

- [x] Drizzle schema and a first migration create monitors, posts, matches and
      feedback
- [x] `posts` has `UNIQUE (source, external_id)`, and a test asserts an insert
      of a duplicate fails
- [x] `posts` has a nullable `pgvector` embedding column
- [x] `matches` has `last_verified_at` and a hidden flag
- [x] `monitors` stores the user's four answers and the generated queries in
      separate columns
- [x] `feedback` records one verdict per match per user, with the timestamp
- [x] Migrations are plain SQL files, numbered, one number per file
- [x] Migrations apply against an empty database and against one that already
      has them, without error

## Notes

- Depends on [US-001](US-001-the-workspace-runs-with-one-command.md).
- STACK.md, *What the economics add to the build*, for why the three columns
  above are correctness concerns and not features.
- One number, one migration file. Two branches that both take the next number
  merge cleanly and break at boot.
- The migration is `packages/core/drizzle/0001_create_core_tables.sql`,
  generated with `pnpm db:generate --name=create_core_tables`.
- `packages/core/src/db/schema.test.ts` holds the constraint assertions.
- Do not add a `status` column to anything the folder structure already says.

## Log

- 2026-09-04 — Written from PLAN.md and STACK.md.
- 2026-09-04 — Built as migration 0001. The decisions the diff cannot say
  follow.
- `last_verified_at` is `NOT NULL` and defaults to now. The Context said
  adding the column later forces someone to decide what a null means. So no
  row ever holds one: a match is verified the moment it is created, because
  the post was fetched to make it.
- Feedback rows are append-only, and a partial unique index on
  `(match_id, user_id) WHERE superseded_at IS NULL` is what makes one verdict
  per match per user true. A plain unique constraint would satisfy this
  ticket and forbid US-012, which requires that a changed verdict is recorded
  rather than overwritten. The two tickets would then contradict.
- `posts` carries no monitor id. A post is stored once and matched against
  every monitor that wants it. That is what the global
  `UNIQUE (source, external_id)` means: a post bought for one monitor is not
  bought again for a second.
- Only `excerpt` is stored, never a full copy of the post. STACK.md,
  *Honor deletions*.
- The embedding is `vector(1536)`, the size of OpenAI's
  `text-embedding-3-small`. Fixed rather than dimensionless because pgvector
  cannot index a dimensionless column, and a user who changes embedding
  provider re-embeds either way. US-008 owns the index.
- `user_id` on monitors and feedback carries no foreign key. Better Auth owns
  the user table and creates it in US-017.
- Added `read_at` and `saved` to matches, beyond this ticket's list. The
  mockup's inbox has Unread and Saved tabs, and US-015 already needs to know
  whether a match was read to set its re-check rate. Both columns are cheap
  now.
- Added `name` to monitors. The mockup wizard asks for a product name, which
  is not one of the four answers.
- Every constraint was checked by removing it from the migration and
  confirming a named test turned red. Nine guards, nine red tests. The one
  guard that survived its own removal, the `posts.source` check, had no test;
  it has one now.
