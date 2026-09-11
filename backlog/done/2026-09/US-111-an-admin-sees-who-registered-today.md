---
id: US-111
title: An admin sees who registered today
type: feature
priority: p2
created: 2026-09-10T18:10+08:00
area: admin
resolution: shipped
---

## Context

The hosted instance takes registrations, and nothing shows who is signing up or
whether an account is used after it exists. The first admin view is one list:
the accounts created on a day, each with the size of the account behind it — its
projects, its monitors, and every match its inbox holds.

`ADMIN_EMAILS` names the admins. There is no role column and no migration: an
admin is an address listed in the environment, and the same instance that holds
the key already holds this. Unset means nobody is an admin, which is the safe
answer for a self-hosted box where the question never comes up.

The endpoint returns every account's data, so it is the security boundary. It
sits behind the session gate like every other API route and then refuses any
account whose email is not listed.

## Acceptance

- [x] `ADMIN_EMAILS` is a comma-separated list in the environment schema and `.env.example`.
- [x] Unset or empty means no account is an admin.
- [x] `GET /api/admin/registrations` answers 403 to a signed-in account that is not listed.
- [x] It lists the accounts created on the requested UTC day, each with its project, monitor and match counts.
- [x] Match counts include hidden matches.
- [x] `?date=YYYY-MM-DD` selects the day; absent means today, UTC.
- [x] The route is behind the session gate, so a signed-out request is 401 before the admin check.
- [x] The admin UI in a new `admin/` app lists the day's registrations.

## Notes

- Backend only for now. The admin UI is a separate app; this ticket ships the API.
- `packages/core/src/admin/overview.ts` owns the query and the admin-list parsing.
- `apps/api/src/admin.ts` owns the route.

## Log

- 2026-09-10T18:10+08:00 — Started. Owner chose `ADMIN_EMAILS`, a separate `admin/` app, and all matches for the inbox count.
- 2026-09-10T18:16+08:00 — Backend done: `ADMIN_EMAILS` in the schema, `.env.example` and the compose file; `registrationsOn` in `packages/core/src/admin/overview.ts`; `GET /api/admin/registrations` in `apps/api/src/admin.ts`. 13 new tests, the full suite (1,890) green, typecheck and build pass. The `admin/` frontend is next.
- 2026-09-10T19:59+08:00 — Frontend done. A Vite + React + Tailwind + shadcn app in `admin/`, a workspace package, built under `/admin/` and served by the API at `/admin` (`/admin` redirects to `/admin/`). It reads the one endpoint same-origin, so it uses the existing session cookie. `pnpm build` and `pnpm typecheck` include it; the Dockerfile copies `admin/dist`. Verified live against the built API: `/admin/` 200, `/admin` 302, assets 200. The whole suite (1,890) still green.
- 2026-09-10T22:02+08:00 — The image did not build. `pnpm-workspace.yaml` gained
  `admin`, but the Dockerfile's dependency stage copies each manifest by name
  and `admin/package.json` was not among them, so `pnpm install` made no
  `admin/node_modules` and `pnpm build` stopped at `sh: vite: not found`. No
  local build can show this: a developer's install has already made that
  directory. CI could not show it either — the image job needs the check job,
  and the check job was red on an unrelated test. Fixed by copying the manifest,
  and proven by building the whole image and running it: `/admin` 302,
  `/admin/` 200, `/api/admin/registrations` 401 without a cookie.

- 2026-09-11T13:12+08:00 — Closed. Both halves shipped and the image builds
  with them: `Add an admin panel at /admin` and `Install the admin panel's
  dependencies in the image`, and the production deploys since have carried
  them. What no run has shown is a person listed: the cloud instance has taken
  no registration yet, so the day's list has only ever been read empty. The
  first registration is US-100's.

