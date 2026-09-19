---
id: US-248
title: schema.ts is split by table family
type: chore
priority: p3
created: 2026-09-20T00:58+08:00
parent:
area: pipeline
resolution: shipped
---

## Context

`packages/pipeline/src/db/schema.ts` is 2,143 lines. A change to one table
loads all of them. The tables fall into families that the pipeline document
already names: monitors and projects, posts and discoveries, matches and
verdicts, the ledgers, the queue's own rows.

## Acceptance

- [x] `schema.ts` re-exports from one file per family, and nothing that
      imports `schema` changes.
- [x] `pnpm db:generate` produces no migration: the split moves code and no
      column.
- [x] `migrations.test.ts` and the boundary tests pass unchanged.

## Notes

- drizzle-kit reads the schema through the path in `drizzle.config.ts`; a
  glob or a barrel both work.

## Log

- 2026-09-20T00:58+08:00 — Written from the context review of 2026-09-20: the owner asked
  where the AI-assisted workflow loses context and quality, and this is one
  of the findings.
- 2026-09-20T01:32+08:00 — Shipped. schema.ts is a 53-line barrel over nine files under db/schema/: vocabulary (the closed lists and the check fragments) and eight table families, 126 to 376 lines each. Every declaration moved without edits. drizzle-kit generate says no schema changes; migrations.test.ts, both boundary tests and the whole suite pass (2,130); release:verify installs and migrates the packed tarballs. The package's public exports are unchanged: index.ts names its exports.
