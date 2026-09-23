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

- [ ] The runtime stage of the image holds none of `vitest`, `vite`,
      `jsdom`, `lightningcss`, `drizzle-kit`, `esbuild` or `mongodb`,
      and the Log lists the `node_modules` size before and after.
- [ ] An image built from the change boots: the migrator runs, `/api/health`
      answers, and one sign-in works. The Log says how it was run.
- [ ] `pnpm licenses list --prod` and `pnpm audit --prod` no longer report
      `lightningcss` or `esbuild`.
- [ ] Development and `pnpm test` are unchanged.

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
