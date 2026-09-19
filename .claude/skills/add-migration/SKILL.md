---
name: add-migration
description: Add or change a table or a column in either migration stream, with the migration written the way CI checks it. Use when a task touches schema.ts, vocabulary.ts, a check constraint, or a Drizzle migration.
---

# Add a migration

The rules are in `AGENTS.md`, *Rules that are easy to break*. This is the
order.

1. Decide the stream. Pipeline tables: `packages/pipeline/src/db/schema.ts`
   and `packages/pipeline/drizzle`. Account tables: `apps/api/src/db/` and
   `apps/api/drizzle`. The pipeline never joins an account table.
2. Edit the schema. If the value is one of the arrays in
   `packages/engine/src/vocabulary.ts` or `modelCallPurposes`, the check
   constraint is built from it and **the suite will not notice a missing
   migration**: write it in this same change.
3. Run `pnpm db:generate` from the root. Never write the SQL by hand. It
   writes the file **and** the `meta/_journal.json` entry; a file the journal
   does not name is applied nowhere.
4. Check the number: `ls packages/pipeline/drizzle | tail -3` (or
   `apps/api/drizzle`). One migration number, one file. If another branch or
   worktree took the same number, regenerate.
5. `pnpm db:migrate` against the folder's own Postgres, then `pnpm test`.
   `db/migrations.test.ts` in each stream fails by name when the journal and
   the folder disagree.
6. If the change reaches the cloud application, say so in the ticket: a
   migration is a minor version for the consumer (`docs/releasing.md`).
