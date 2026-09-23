---
id: US-306
issue: 61
title: The image runs on ARM
type: feature
priority: p2
created: 2026-09-22T18:56+08:00
parent:
area: deployment
resolution: shipped
---

## Context

`docker manifest inspect ghcr.io/rszhd/signalscout:latest` returns one
architecture: amd64. `ci.yml`'s build step names no platforms, so that is
everything the registry has.

This product is built for a 1 GB VPS, and the cheapest 1 GB boxes are ARM.
Hetzner's Ampere line is the cheapest hosting in Europe, Oracle's free tier
is Ampere, and a Raspberry Pi is the machine somebody already owns. All three
answer `docker compose up` with `exec format error`, which reads like a
broken release rather than a missing build.

The audience this repository is written for is exactly the audience that
cannot run it.

## Acceptance

- [x] `ci.yml`'s build step names `linux/amd64,linux/arm64`, and
      `release.yml`'s version-tagging step does the same, so a pinned version
      is available on both.
- [x] `docker manifest inspect` on `latest` and on a version tag lists both.
      True of `latest` since 2026-09-22. A version tag is the next release,
      and `release.yml` builds both unconditionally.
- [x] The arm64 image is started once and answers on its port. Record where
      it was run in the Log — emulation is enough to prove the image, and the
      Log says it was emulation rather than a real board.
- [x] docs/self-hosting.md says both architectures are published.
- [x] The Log records what the change did to the CI build time.

## Notes

- `docker/setup-qemu-action` is needed beside `setup-buildx-action` for the
  cross build. The GitHub Actions cache is shared per platform, so the first
  arm64 build has no cache and is the slow one.
- Check the native dependencies first. `pg` is pure JavaScript, but anything
  with a prebuilt binary needs an arm64 one to exist.

## Log

- 2026-09-22T18:56+08:00 — Written after `docker manifest inspect` showed one architecture.
- 2026-09-22T19:45+08:00 — The dependencies were checked first, as the Notes said. `pnpm-lock.yaml` already carries `@esbuild/linux-arm64` and `@rollup/linux-arm64` as optional entries, so pnpm resolves them on an arm64 install; nothing else in the image is architecture-specific.
- 2026-09-22T19:45+08:00 — **Built and run before touching CI.** `docker buildx build --platform linux/arm64` on a docker-container builder with `tonistiigi/binfmt` emulation, then started through the compose file with `SIGNALSCOUT_IMAGE` pointing at it. `uname -m` in the container reads **aarch64**, the migrate container printed `migrations applied to intentwatch`, and `GET /api/health` answered **200**. That is emulation on an amd64 machine, not a real board, which proves the image and not the performance.
- 2026-09-22T19:45+08:00 — arm64 is built only where it is published. A pull request still builds amd64 alone, so it stays quick, and an arm64-only break would appear at merge instead of in the pull request. The comment in `ci.yml` says so rather than leaving it to be discovered. `release.yml` builds both unconditionally: a pinned version that exists for one architecture is worse than no pinned version.
- 2026-09-22T19:45+08:00 — If the emulated build time becomes the problem, the fix is a native `ubuntu-24.04-arm` runner and a manifest merge, not dropping the platform. That would restructure the image job, which currently exposes one `digest` output that `release.yml` depends on — a multi-platform build keeps that output meaningful because the digest is the manifest list's.
- 2026-09-22T19:55+08:00 — Published. The manifest for `:latest` lists `linux/amd64` and `linux/arm64`, read from the registry rather than from a local pull, so it is what a self-hoster's Docker will see.
- 2026-09-22T19:55+08:00 — **The cost, measured on the first run: the image job took 8m36s, against 1m11s on the previous amd64-only push.** About seven extra minutes per merge to `main`, on a run with no arm64 layer cached. Later runs reuse the GitHub Actions cache per platform and should be faster, but emulation is emulation and this will not return to a minute.
- 2026-09-22T19:55+08:00 — Seven minutes per merge is worse than expected and is the reason to keep the native-runner note visible rather than treat this as finished thinking. If `main` starts taking several merges a day, move the build to `ubuntu-24.04-arm` — free for a public repository — and merge two native builds into one manifest. That restructures the image job and its `digest` output, which is why it was not done first; the cost of doing it later is that restructuring, not a second migration.
