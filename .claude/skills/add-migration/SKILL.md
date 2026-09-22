---
name: add-migration
description: Add or change a table or a column in either migration stream, with the migration written the way CI checks it. Use when a task touches schema.ts, vocabulary.ts, a check constraint, or a Drizzle migration.
---

# Add a migration

**The procedure is [`docs/pipeline.md`](../../../docs/pipeline.md), *Adding a
migration*.** Read it and follow it; it is written for a person and it is the
same six steps. The rules behind them are in `AGENTS.md`, *Rules that are easy
to break*.

Three things cost the most when they are forgotten, so they are here too:

- **A value added to `vocabulary.ts` or `modelCallPurposes` is also a check
  constraint**, and the suite will not notice the missing migration. Write it
  in the same change.
- **`pnpm db:generate`, never hand-written SQL.** It writes the
  `meta/_journal.json` entry, and a migration the journal does not name is
  applied nowhere.
- **One migration number, one file.** Two worktrees cannot see each other's,
  so check `ls packages/pipeline/drizzle | tail -3` before committing.
