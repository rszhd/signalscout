---
id: US-152
title: The stateless half of core becomes the engine
type: chore
priority: p1
created: 2026-09-16T13:46+08:00
parent: US-151
area: architecture
resolution: shipped
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
  `reply-voices`, `triage`, `triage-prompt`, `probe`, `fixtures/`. Not `keys`,
  `settings`, `record`, `draft-context`, `reply-prompts`: those read the
  database and stay. (`reply-prompts` was going to split; it turned out to be
  table reads only, with the presets already in `reply-voices`.)
* `filter/description`, `filter/keywords`, `estimate/estimate`,
  `secrets/cipher`, `logger`, `net`, `monitors/signals` (as `signals.ts`),
  `sources/storage`, `testing/network`.

**Eight vocabulary constants move out of `db/schema.ts`.** `sources`,
`providers`, `signals`, `intentTypes`, `embeddingDimensions`, `aiTasks`,
`defaultMinimumScore` and `defaultSimilarityThreshold` are what the moving
files import from the schema. They are the product's vocabulary, not the
database's. They move to `engine/src/vocabulary.ts`; `schema.ts` imports them
from the engine and keeps building its check constraints from them.
`modelCallPurposes` stays: nothing in the engine reads it. AGENTS.md's rule —
a value added to an array in `schema.ts` is not a value the database accepts
— gets one more step: the array is now in the engine, and the migration is
still in core. Say so in the rule.

**The AI variables' schema moves too.** The capture scripts parse `AI_*` with
`aiEnvSchema`, which lived in `config/env.ts` beside every other variable.
The `aiFields` object and its two helpers move to `engine/src/ai/env.ts`;
core's `env.ts` imports them back and spreads them into the whole schema, so
each variable is still declared once. The capture scripts are the boundary
test's one named exception to the `process.env` rule: they are instruments,
run by hand, and an entry point is where the environment is read.

**The cipher loses its default.** `secrets/cipher.ts` reads `process.env` as
a default parameter in two places. The default goes; the two callers in core
pass `process.env` themselves.

**The live scripts and captures do not move yet.** `capture:*` writes into
`ai/fixtures`, which moves, so the `package.json` script paths in `core`
change to point at the engine. The `live:*` scripts read the database and
stay in core. US-153 sorts out which package owns which command.

## Acceptance

- [x] `packages/engine/src/engine-boundary.test.ts` exists, asserts the four
      rules above, and was committed before any file moved.
- [x] Every file in the *what moves* list is under `packages/engine/src`, by
      `git mv`, so `git log --follow` still works.
- [x] `packages/core/src/index.ts` re-exports every name it exported before,
      from the engine where it moved. `apps/api` and `apps/worker` have no
      import changed.
- [x] `db/schema.ts` imports the eight vocabulary constants from
      `@signalscout/engine` and defines none of them.
- [x] `secrets/cipher.ts` has no `process.env` in it; `pnpm db:rotate-key`
      still works.
- [x] `vitest.config.ts` aliases `@signalscout/engine` to its source, the same
      way it does for core, and `pnpm test` passes with the same count of
      test files as before the move, plus one.
- [x] `pnpm typecheck`, `pnpm lint` and `pnpm build` pass. `tsconfig.json`
      references the new package; `core` references `engine`.
- [x] `docker build` produces an image that starts and answers
      `/api/health`. The Dockerfile copies the new package.
- [x] Each `capture:*` command points at a file that exists, in the package
      that owns it — the five model captures moved to
      `packages/engine/package.json` with the fixtures they write.
- [x] AGENTS.md, *Rules that are easy to break*: the rule about `packages/core`
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
- 2026-09-16T14:30+08:00 — Built. 91 files moved by `git mv`, plus
  `monitors/signals`, `sources/storage` and `testing/network`. The boundary
  test caught two comments that named the forbidden read; the comments were
  reworded, not the test. Biome reformatted the captured fixture JSON when the
  exclusion still named `packages/core`; the files were restored byte for byte
  and the exclusion moved. `tsc --build` from clean failed once because
  core's reference to the engine was lost in that restore; put back, clean
  build passes. Suite: 120 files, 2,081 tests, all pass — 119 files before.
  The image builds, starts against a copy of the database and answers
  `/api/health`. `pnpm db:rotate-key` re-encrypted 5 credentials in the
  worktree copy. Not run live: nothing here reaches a provider or a model.
- 2026-09-16T17:58+08:00 — Shipped in PR #8, merged to main at c9114c1 and deployed to production; health answers.
