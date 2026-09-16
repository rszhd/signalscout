---
id: US-152
title: The stateless half of core becomes the engine
type: chore
priority: p1
created: 2026-09-16T13:46+08:00
parent: US-151
area: architecture
resolution:
---

## Context

**This is step one of US-151, and it changes nothing that runs.** Files move
from `packages/core` to a new `packages/engine`; `core` imports them from
there; the API, the worker and every test see the same exports as before.
The point of doing it first and alone is that the diff is a move, and a
reviewer can check a move.

**The boundary test is written before the first file moves.** It is the
whole definition of "stateless" here, and it says four things to CI:

1. `packages/engine` declares none of `pg`, `drizzle-orm`, `drizzle-kit`,
   `pg-boss`, `better-auth`, `stripe`, `fastify`, `react` as a dependency.
2. No source file under `packages/engine/src` imports any of them.
3. No source file under `packages/engine/src` imports from
   `packages/core` — the direction is `core → engine`, never back.
4. No source file under `packages/engine/src` reads `process.env`. A key,
   a model name or a base URL is an argument. A default parameter of
   `= process.env` counts as a read.

`core-boundary.test.ts` is the model; copy its shape, not its list.

**What moves.** Counted on 2026-09-16 from the import graph:

* `sources/` — `types`, `platforms`, `registry`, `offering`, `runtime`,
  `index`, `fake/`, `providers/**` with their fixtures and tests. Not
  `choices`, `returns`, `storage`, `live-*`, `measure-lead-position`: those
  read the database and stay.
* `ai/` — `call`, `classification`, `classify`, `config`, `describe`, `draft`,
  `embed`, `prompt`, `provider`, `queries`, `recommended`, `reply`,
  `reply-prompts` split (the prompt text moves, the table read stays),
  `reply-voices`, `triage`, `triage-prompt`, `probe`, `fixtures/`. Not `keys`,
  `settings`, `record`, `draft-context`: those read the database and stay.
* `filter/description`, `filter/keywords`, `estimate/estimate`,
  `secrets/cipher`, `logger`, `net`.

**Seven vocabulary constants move out of `db/schema.ts`.** `sources`,
`providers`, `signals`, `intentTypes`, `embeddingDimensions`,
`modelCallPurposes` and `aiTasks` are what five of the moving files import
from the schema. They are the product's vocabulary, not the database's. They
move to `engine/src/vocabulary.ts`; `schema.ts` imports them from the engine
and keeps building its check constraints from them. AGENTS.md's rule — a
value added to an array in `schema.ts` is not a value the database accepts —
gets one more step: the array is now in the engine, and the migration is
still in core. Say so in the rule.

**The cipher loses its default.** `secrets/cipher.ts` reads `process.env` as
a default parameter in two places. The default goes; the two callers in core
pass `process.env` themselves.

**The live scripts and captures do not move yet.** `capture:*` writes into
`ai/fixtures`, which moves, so the `package.json` script paths in `core`
change to point at the engine. The `live:*` scripts read the database and
stay in core. US-153 sorts out which package owns which command.

## Acceptance

- [ ] `packages/engine/src/engine-boundary.test.ts` exists, asserts the four
      rules above, and was committed before any file moved.
- [ ] Every file in the *what moves* list is under `packages/engine/src`, by
      `git mv`, so `git log --follow` still works.
- [ ] `packages/core/src/index.ts` re-exports every name it exported before,
      from the engine where it moved. `apps/api` and `apps/worker` have no
      import changed.
- [ ] `db/schema.ts` imports the seven vocabulary constants from
      `@signalscout/engine` and defines none of them.
- [ ] `secrets/cipher.ts` has no `process.env` in it; `pnpm db:rotate-key`
      still works.
- [ ] `vitest.config.ts` aliases `@signalscout/engine` to its source, the same
      way it does for core, and `pnpm test` passes with the same count of
      test files as before the move, plus one.
- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm build` pass. `tsconfig.json`
      references the new package; `core` references `engine`.
- [ ] `docker compose build` produces an image that starts and answers
      `/health`. The Dockerfile copies the new package.
- [ ] Each `capture:*` command in `packages/core/package.json` still points at
      a file that exists.
- [ ] AGENTS.md, *Rules that are easy to break*: the rule about `packages/core`
      names both packages and the direction between them; the `schema.ts`
      rule names the vocabulary file.

## Notes

* `packages/core/src/core-boundary.test.ts` — the pattern for the new test.
* `vitest.config.ts` — the alias block; the longer specifier must come first.
* `Dockerfile` — check which folders are copied before the build.
* `tsconfig.json`, `apps/*/tsconfig.json` — project references.
* Files that import a vocabulary constant from the schema today:
  `ai/classification.ts` (`intentTypes`), `ai/describe.ts` (`signals`),
  `ai/embed.ts` (`embeddingDimensions`), `ai/prompt.ts` and
  `ai/triage-prompt.ts` (`Signal`), `ai/recommended.ts` (`AiTask`),
  `sources/storage.ts` (`sources`).

## Log

- 2026-09-16T13:46+08:00 — Written as step one of US-151.
