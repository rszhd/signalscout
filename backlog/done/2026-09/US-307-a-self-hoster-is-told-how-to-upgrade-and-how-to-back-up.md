---
id: US-307
title: A self-hoster is told how to upgrade, and how to back up
type: chore
priority: p2
created: 2026-09-22T18:58+08:00
parent:
area: docs
resolution: shipped
---

## Context

Two instructions a self-hosted product cannot leave out are missing from
every page here.

**Upgrading.** No document contains `docker compose pull`. Somebody who
installed 0.13.1 has no told path to the next version, so they stay on the
one they installed — which is the version every bug report then comes from.
This instance runs migrations at boot, so the instruction is not one line:
it has to say back up first, that the `migrate` container runs to completion
before the app starts, and what to do when it fails.

**Backing up.** `secrets.md` says "restore the backup from step 1" inside the
key rotation procedure, and no page says how to make one. Here that omission
is worse than usual: the database holds provider keys encrypted with
`ENCRYPTION_KEY`, so **a dump taken without that key is unrecoverable**. That
is a sentence somebody must read before they need it.

## Acceptance

- [x] docs/self-hosting.md has an *Upgrading* section: back up, `docker
      compose pull`, `docker compose up -d`, and what the migrate container
      does. It says a version can be pinned with `SIGNALSCOUT_IMAGE` and that
      `latest` follows `main`.
- [x] It says what to do when the migrate container fails: the app does not
      start, the old image still runs against the migrated database or does
      not, and the restore is the way back.
- [x] docs/self-hosting.md has a *Backing up* section with the `pg_dump` line
      for the compose install and the `psql` restore.
- [x] **`ENCRYPTION_KEY` and `AUTH_SECRET` are named as part of the backup**,
      in bold, with the consequence of losing the first stated plainly: the
      stored provider keys cannot be read and must be entered again.
- [x] docs/secrets.md's rotation procedure links the backup section rather
      than assuming a backup exists.
- [x] README.md's *Running it* links both.

## Notes

- The dump command has to name the container, because the install has no
  local `psql`: `docker compose exec -T postgres pg_dump -U intentwatch
  intentwatch | gzip > …`.
- Say what is *not* in the dump: the `.env` file, which holds both secrets.

## Log

- 2026-09-22T18:58+08:00 — Written after searching every document for `docker compose pull` and for a backup command, and finding neither.
- 2026-09-22T19:25+08:00 — Shipped. docs/self-hosting.md gained *Upgrading* and *Backing up* between the install and the keys, so they are read in the order somebody meets them. secrets.md's rotation step 1 links the backup section rather than assuming one exists, and README.md's pointer names both.
- 2026-09-22T19:25+08:00 — **Both commands were run, not just written.** A stack from the published image, `pg_dump` through `docker compose exec -T` into a gzip: 16K. Restored into a fresh database on the same server with the documented `psql` line: **zero errors, 31 tables**. The commands name the container because the install has no local `psql`, which is the point of the Docker path.
- 2026-09-22T19:25+08:00 — The *Upgrading* section says the migrate container runs to completion first and that a failure there stops the app on purpose, because a half-migrated database serving requests is worse than one serving none. Going back is restore plus a pinned `SIGNALSCOUT_IMAGE`; the old image against an already-migrated database is not a state this project tests and the section says so rather than implying it is safe.
- 2026-09-22T19:25+08:00 — A stale line was found and fixed while writing this. *The image* said "**That image is not published yet**, so the build command above is the one to use until it is." It has been published throughout, and US-295 had just made pulling it the primary install — so the page told a self-hoster to compile on their own server for no reason, two sections below the install that says not to.
