---
id: US-135
title: A worktree runs the whole stack on ports of its own
type: chore
priority: p2
created: 2026-09-15T14:22+08:00
parent:
area: tooling
resolution:
---

## Context

**Two agents work on this repository at the same time, in two git worktrees,
and only one of them can run the product.** A worktree separates the files. It
separates nothing else. `pnpm dev` starts the API on 3000, Vite on 5173 and the
Postgres container named `intentwatch`, and those three names are the same in
every folder. The second `pnpm dev` either fails on a taken port or, worse,
succeeds and migrates the first one's database.

**Three values are written down rather than read from the environment.**
`docker-compose.yml` binds `127.0.0.1:5432:5432`, so a second Postgres cannot
start. `apps/web/vite.config.ts` sets `port: 5173` and proxies `/api` to
`http://localhost:3000`, so a second UI on a new port would still call the first
API. `PORT` is already read (`config/env.ts`), and is the shape the other three
should copy.

**Compose already gives a folder its own container set.** `COMPOSE_PROJECT_NAME`
in a worktree's `.env` beats the `name: intentwatch` line in the compose file —
checked on 2026-09-15 with `docker compose config`, which resolved the project,
the network and the data volume under a new prefix. So the isolation needs no
new compose file, only a port that varies with it.

**A worktree lives inside the main checkout, at `worktrees/<name>`.** The
reason is the review, not the running: one editor window opened on the main
folder lists every worktree as its own repository in one source-control view, so
the owner reads what each agent changed without opening a window per agent. The
cost is that a working tree then sits inside another working tree, and the
second one must not treat it as content: `git status` in the main checkout
already reports `?? .claude/` for exactly this reason, and Biome reads
`.gitignore`, so an un-ignored folder would be walked on every `pnpm lint`. Both
ignore files carry the folder.

**A container per worktree, not one Postgres holding several databases.** One
Postgres would be cheaper in memory and would collide in connections. The suite
creates a database per test file and runs them in parallel, which is why
`vitest.config.ts` pins `DATABASE_POOL_SIZE` to 3 against a `max_connections` of
100. Two agents running the suite at once would cross that line, and the file
that loses reports "sorry, too many clients already" — a collision that reads as
a flaky test.

**A new worktree starts with a copy of the main database, not an empty one.** An
empty database means signing up again, making a project, making a monitor and
waiting for a poll before any screen has anything on it. An agent asked to
change the inbox needs an inbox. `pg_dump` carries the schema, the data and the
table of applied migrations, so the copy is a working instance and a migration
written in the worktree applies on top of it.

**The copy is the dangerous half, and the danger is money.** It carries the
monitors, their schedules and the provider keys. The worker starts with
`pnpm dev`, the scheduler finds a monitor due, and a real provider and a real
model are billed — for a poll nobody asked for, in a folder nobody is watching.
The budget guard bounds that spend. It does not prevent it. So every monitor in
a copy is paused on arrival: `monitors.paused_at` is null when a monitor runs
and the scheduler skips a paused row, so one statement after the restore closes
it. The agent unpauses one deliberately when it needs a poll.

**The keys are copied, and that is the decision.** Each worktree then holds the
provider keys and the model key on its own disk, under `ENCRYPTION_KEY` copied
from the main `.env` — a different key would leave every stored credential
unreadable and the connections screen offering keys nobody can spend. The reason
to accept that spread is that an agent that cannot read a key cannot touch a
connector at all, which is most of this repository. The pause is what makes it
safe, so the pause is not optional.

## Acceptance

- [x] `docker-compose.yml` publishes Postgres on `${POSTGRES_PORT:-5432}`, so an
      unset variable binds 5432 and every instance running today is unchanged
- [x] `apps/web/vite.config.ts` reads its own port and its proxy target from the
      environment, defaulting to 5173 and 3000
- [ ] The Vite proxy targets the API port of its own worktree. A request to the
      second UI never reaches the first API
- [ ] `scripts/new-worktree.mjs <name>` adds the worktree, picks a port slot no
      running worktree holds, writes `.env`, starts Postgres, copies the main
      database and pauses every monitor in the copy
- [x] The worktree is created at `worktrees/<name>` inside the main checkout,
      whichever folder the script is run from
- [x] `.gitignore` and `.dockerignore` both exclude `worktrees/`, so the folder
      is not untracked content of the repository it sits in and `pnpm lint` does
      not walk it
- [ ] One editor window opened on the main checkout lists every worktree in its
      source-control view. Say whether this was seen or only configured
- [x] The written `.env` carries `ENCRYPTION_KEY` and `AUTH_SECRET` from the main
      `.env`, so copied credentials stay readable
- [x] Every monitor in a copied database has `paused_at` set. Asserted against
      real Postgres, on a database seeded with a running monitor
- [x] The port slot allocator is asserted: two worktrees never receive the same
      slot, and a slot released by a removed worktree is offered again
- [x] `pnpm dev` in the main checkout still needs no new variable. Every default
      is what it is today
- [ ] The suite passes in two worktrees at the same time, each against its own
      Postgres. Say whether this was run or reasoned
- [x] No test starts a container, reaches a provider or calls a model

## Notes

- `scripts/dev.mjs` spawns `docker compose` without the merged env, but Compose
  reads the folder's own `.env` for `COMPOSE_PROJECT_NAME` and for
  interpolation, so nothing there needs changing. Confirm it rather than assume
  it.
- A worktree is removed with `git worktree remove`, which leaves the container
  and the volume behind. The script needs a partner that removes both, or the
  next agent inherits a stale database on that slot. Decide whether that is this
  ticket or the next one.
- The port table is three numbers from one slot index: `3000 + n`, `5173 + n`,
  `5432 + n`. Keep it that way — an agent reading 3002 should know without
  looking that it is slot 2.
- `docs/testing.md` says the suite needs the Postgres that `pnpm db:up` starts.
  That sentence becomes wrong in a worktree, where the container is the
  worktree's own. Update it in this change.

## Log

- 2026-09-15T15:10+08:00 — The owner asked for the worktrees to sit inside the
  main checkout rather than beside it, so that one editor window shows every
  agent's changes in one source-control view. The location changed, and with it
  the two ignore files and a `.vscode/settings.json` written into the main
  checkout — VS Code finds repositories one level down by default and
  `worktrees/<name>` is two. The settings file is left untracked: where one
  person keeps their folders is not a decision this repository makes.
- 2026-09-15T14:22+08:00 — Written. The owner ran two agents in two worktrees
  and found that only one could run the product, and that the second `pnpm dev`
  would migrate the first one's database.
