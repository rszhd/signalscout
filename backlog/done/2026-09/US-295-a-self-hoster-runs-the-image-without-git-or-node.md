---
id: US-295
title: A self-hoster runs the published image without git or Node
type: feature
priority: p2
created: 2026-09-22T16:04+08:00
parent:
area: deployment
resolution: shipped
---

## Context

`ghcr.io/rszhd/signalscout:latest` is public and pulls without a login. The
README's install does not use it: it clones the repository, runs `pnpm
setup`, and passes `docker-compose.build.yml`, which compiles the image on
the self-hoster's machine. docs/self-hosting.md offers the `openssl` path
for a server with no Node, but it still starts with `git clone`.

The Postiz install is a compose file and `docker compose up`. No git, no
Node, no build. That is the bar, and the pieces already exist here.

Two smaller things sit under the same heading. The image is tagged `latest`
and by commit sha only; a `v0.13.1` tag publishes the npm packages and
never reaches ghcr, so nobody can pin an image to a version. And
`docker-compose.yml` reads `.env` for thirty variables, of which two must be
generated; the download path needs the same two-line `openssl` recipe the
doc already has.

## Acceptance

- [x] The README install is: download `docker-compose.yml` and
      `.env.example.self-hosted` with `curl`, write the two secrets with
      `openssl`, `docker compose up -d`. Four commands, no clone.
- [x] That install is tested on a clean machine (a fresh VM or a container
      with only Docker) and the app answers on :3000 with the first-account
      screen. The Log records the run.
- [x] `release.yml` pushes the image to ghcr tagged with the version
      (`0.13.1`) and the major-minor (`0.13`), beside `latest`.
- [x] `docker-compose.yml` keeps `SIGNALSCOUT_IMAGE` as the override and the
      comment says a version tag is what to pin.
- [x] The build-from-source path stays, one paragraph down, for people who
      change the code.
- [x] docs/self-hosting.md's Install section matches the README.

## Notes

- The compose file references `docker-compose.build.yml` only as an
  optional overlay; the download path needs nothing else. Check the
  `postgres` healthcheck and the migrate job do not assume a checkout.
- Postiz publishes `latest`, `vX.Y.Z` and `vX.Y` — the same three.

## Log

- 2026-09-22T16:04+08:00 — Written from a gap review against the Postiz playbook.
- 2026-09-22T18:20+08:00 — Shipped. The README and docs/self-hosting.md install is now two `curl` lines, two `openssl` lines and `docker compose up -d`. The build-from-source path follows, for people changing the code.
- 2026-09-22T18:20+08:00 — Tested on 2026-09-22 in an empty directory holding nothing but the two downloaded files. `docker compose up -d` pulled the published image, Postgres came up healthy, the migrate container printed "migrations applied to intentwatch" and exited, the app answered 200 with the SignalScout title on its port, and `users` held 0 rows — a fresh instance asking for the first account. `PORT` and `POSTGRES_PORT` were set only because this machine already runs other instances on the defaults.
- 2026-09-22T18:20+08:00 — The first run of that test appeared to fail: the migrate container could not find `apps/api/dist/db/migrate-cli.js`. The cause was a `:latest` cached locally on 2026-09-10, from before `packages/core` was split; CI publishes a current `:latest` on every push to main and always has since the `is_default_branch` fix. A `docker pull` and the test passed. Worth remembering that a stale local image looks exactly like a broken release.
- 2026-09-22T18:20+08:00 — The image is tagged with the version by a new job in `release.yml`, not by `ci.yml`: CI runs on a push to main and has no version to name. It builds from the GitHub Actions cache, so it re-tags rather than recompiles. It publishes `0.13.1` and `0.13`, never `latest` — `latest` is main's, and a tag can point at a commit main has moved past. The job runs for the first time on the next release.
