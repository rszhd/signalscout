---
id: BUG-012
title: db:generate has not worked since 0038
type: bug
priority: p2
created: 2026-09-09T14:37+08:00
parent:
area: database
resolution: fixed
---

## Context

**`pnpm db:generate` refuses to run and has done since migration 0038.**

```
Error: [drizzle/meta/0037_snapshot.json, drizzle/meta/0038_snapshot.json] are
pointing to a parent snapshot: drizzle/meta/0037_snapshot.json/snapshot.json
which is a collision.
```

Two snapshots carry the same `id` and the same `prevId`, so drizzle-kit cannot
tell which one the chain continues from and stops before it reads the schema.

**Every migration since has been written by hand**, which is how it stayed
hidden: 0039 through 0052 are correct SQL, and the command that would have
written them for us was never the thing that failed a test. AGENTS.md's
*Commands* section does not mention that `db:generate` is broken, so the next
person reads a working command and meets an error.

**The dangerous half is the second step, not the error.** A hand-written
migration also needs its entry in `drizzle/meta/_journal.json`, and nothing
checks that it is there. Without the entry the file is invisible: `pnpm test`
creates its databases from the journal, so **the suite passes against a
database missing the column**, and only a deployment finds out. US-083 hit
exactly that — 33 tests failed on `column "is_default" does not exist` until
the journal entry was added, and the failure at least happened to be loud that
time because the column was read on every path.

That is the same shape as this repository's two most expensive misses: `apify`
in US-057 and `draft_reply` in US-040, where a value existed in TypeScript and
not in the database, a full suite passed, and a live run found it after the
money was spent.

**The repair is two edits and it has been rehearsed.** Re-chain `0038` — a
fresh `id`, and `prevId` pointing at `0037`'s — and add a `0052_snapshot.json`
holding the current schema with `prevId` pointing at `0038`'s. drizzle-kit then
answers *No schema changes, nothing to migrate*, which is the correct answer
for a repository whose migrations are all applied. Proven in a scratch copy on
2026-09-09 before any file in `drizzle/` was touched.

**Snapshots 0039 to 0051 stay missing, and that is a decision.** drizzle-kit
diffs against the latest snapshot alone, so nothing needs them. Writing them
would mean inventing what the schema looked like at fourteen past moments — a
file that describes our own guess rather than a state that existed, which is
the rule AGENTS.md already applies to fixtures.

## Acceptance

- [x] `pnpm db:generate` runs and answers "No schema changes" against the
      current schema
- [x] A real schema change produces a migration holding that change alone, and
      not a repeat of everything since 0038
- [x] `pnpm test` still passes, which is the evidence that no applied migration
      and no journal entry moved
- [x] AGENTS.md's *Commands* section says a hand-written migration needs its
      journal entry, or says the command works again and the step is gone
- [x] Something fails when a migration file has no journal entry — a check in
      `backlog/index.sh`'s spirit, run by `pnpm lint` or by the suite

## Notes

- The last box is the one that matters. The other four repair the command; that
  one repairs the class of mistake, and it is cheap: read the directory, read
  the journal, compare the two lists.
- Do not renumber or reword any existing migration file. A deployment records
  the hash of the SQL it applied, so an edited file is a migration that runs
  again or refuses to.
- `drizzle-kit generate` writes the new snapshot itself. The repair uses the
  one it wrote, renamed and re-chained, rather than a snapshot written by hand.

## Log

- 2026-09-09T14:37+08:00 — Written after the owner ran `pnpm db:generate` and
  met the error. Found while US-083 needed migration 0052 and the command
  refused, so that migration was hand-written like the fourteen before it.
- 2026-09-09T14:52+08:00 — Fixed. Two files changed in `drizzle/meta/`: `0038`
  re-chained, and a `0052` snapshot holding the current schema. No SQL file and
  no journal entry moved, which is why every applied database is untouched.

  Both halves are proven rather than argued. `db:generate` now answers *No
  schema changes*; a throwaway column added to `ai_keys` generated one line and
  nothing else, and was reverted.

  **The last box is the one worth keeping.** `db/migrations.test.ts` compares
  the directory with the journal and names the file that is missing from
  either, and it was checked by deleting the newest journal entry — it fails
  with `0052_one_key_is_the_default.sql` in the message. It also refuses two
  snapshots sharing an id, which is the fault that started this, so the tool
  cannot be turned off in silence a second time.

  Snapshots 0039 to 0051 are still absent and stay that way. drizzle-kit diffs
  against the latest alone, and writing the other thirteen would mean inventing
  what the schema looked like at thirteen past moments.
