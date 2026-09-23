---
id: BUG-338
issue: 86
title: The image ships the development tools
type: bug
priority: p2
created: 2026-09-23T07:58+08:00
parent: US-332
area: release
resolution:
---

## Context

The published image carries tools that no process in it runs. Listed from
`ghcr.io/rszhd/signalscout:latest` on 2026-09-23: `vitest` 5.0.0,
`vite` 8.2.2, `jsdom` 30.0.1, `lightningcss` 1.33.0, `drizzle-kit`
0.31.10, the `mongodb` driver 7.6.0, and `esbuild` in three versions,
0.18.20 among them. Together they are about 80 MB of the image's 330 MB of
`node_modules`.

The cause is one line of the lockfile. `better-auth` declares optional peers
— `vitest`, `drizzle-kit`, `mongodb`, `react`, `react-dom` — and pnpm
resolves them to the workspace's own development copies, so the lockfile
records them under `better-auth`'s `optionalDependencies`. The image's
runtime stage runs `pnpm install --frozen-lockfile --prod`, which installs
optional dependencies, so they arrive with it.

It is why US-332 met an MPL-2.0 license and a moderate `esbuild` advisory in
the "production" tree: both came in by this door. The migrator does not need
`drizzle-kit`: `migrate-cli.js` uses `drizzle-orm`'s migrator.

## Acceptance

- [x] The runtime stage of the image holds none of `vitest`, `vite`,
      `jsdom`, `lightningcss`, `drizzle-kit`, `esbuild` or `mongodb`,
      and the Log lists the `node_modules` size before and after.
- [ ] An image built from the change boots: the migrator runs, `/api/health`
      answers, and one sign-in works. The Log says how it was run.
- [x] `pnpm licenses list --prod` and `pnpm audit --prod` no longer report
      `lightningcss` or `esbuild`.
- [x] Development and `pnpm test` are unchanged.

## Notes

- Two ways in. A `.pnpmfile.cjs` `readPackage` hook that removes the
  unused optional peers from `better-auth`, which changes the lockfile and
  nothing else; or `--no-optional` on the runtime install, which is shorter
  and also drops every other optional dependency, some of which may be a
  native binary something needs. Check which before choosing.
- `drizzle-orm` and `pg` are peers `better-auth` really uses. Keep them.
- The hosted repository builds its own image and may carry the same leak.

## Log

- 2026-09-23T07:58+08:00 — Found while doing US-332, by listing `node_modules/.pnpm` in the
  published image.
- 2026-09-23T08:40+08:00 — **Fixed by a `.pnpmfile.cjs` hook; the image build is still owed.**
  The hook removes seventeen optional peers from `better-auth` and its
  `@better-auth/*` packages — every framework, database and tool this
  project does not use. It is a deny list, because those packages also
  declare peers the login needs (`kysely`, `drizzle-orm`, `pg`). The code
  imports only `better-auth`, `better-auth/adapters/drizzle` and
  `better-auth/api`; nothing uses the React client. The lockfile lost 79
  lines and gained the hook's checksum, so both install stages of the
  `Dockerfile` copy the hook.

  `--no-optional` was measured and refused: it drops 154 of 293 packages,
  among them `@opentelemetry/api`, `ws` and `tslib`, far more than the leak.

  **Proved**, on a copy of the runtime stage made the way the `Dockerfile`
  makes it (manifests, lockfile, hook, `pnpm install --frozen-lockfile
  --prod`, then the built `dist` folders): 308 packages and 251 MB of
  `node_modules` before, 162 and 104 MB after, with none of the seven
  tools. It booted in production mode against a fresh Postgres: the migrator
  applied every migration, `/api/health` answered with the worker in
  process, a sign-up, a sign-in and a signed-in read each answered 200, and
  the page loaded. `pnpm check:licenses` passes without `lightningcss` and
  `pnpm audit --prod` finds nothing. Full suite: 133 files, 2,331 tests.

  **Not proved:** an image built from the `Dockerfile`. Two local builds
  could not download the development tree — this machine reached the npm
  registry at about 14 KB/s and the build's downloads timed out — though pnpm
  inside the build accepted the hook and the lockfile ("Lockfile is up to
  date"). CI builds the image on a pull request and on `main`; that run
  closes the second box.
