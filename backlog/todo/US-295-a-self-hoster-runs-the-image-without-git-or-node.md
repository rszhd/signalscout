---
id: US-295
title: A self-hoster runs the published image without git or Node
type: feature
priority: p2
created: 2026-09-22T16:04+08:00
parent:
area: deployment
resolution:
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

- [ ] The README install is: download `docker-compose.yml` and
      `.env.example.self-hosted` with `curl`, write the two secrets with
      `openssl`, `docker compose up -d`. Four commands, no clone.
- [ ] That install is tested on a clean machine (a fresh VM or a container
      with only Docker) and the app answers on :3000 with the first-account
      screen. The Log records the run.
- [ ] `release.yml` pushes the image to ghcr tagged with the version
      (`0.13.1`) and the major-minor (`0.13`), beside `latest`.
- [ ] `docker-compose.yml` keeps `SIGNALSCOUT_IMAGE` as the override and the
      comment says a version tag is what to pin.
- [ ] The build-from-source path stays, one paragraph down, for people who
      change the code.
- [ ] docs/self-hosting.md's Install section matches the README.

## Notes

- The compose file references `docker-compose.build.yml` only as an
  optional overlay; the download path needs nothing else. Check the
  `postgres` healthcheck and the migrate job do not assume a checkout.
- Postiz publishes `latest`, `vX.Y.Z` and `vX.Y` — the same three.

## Log

- 2026-09-22T16:04+08:00 — Written from a gap review against the Postiz playbook.
