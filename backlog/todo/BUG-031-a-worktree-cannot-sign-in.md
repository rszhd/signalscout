---
id: BUG-031
title: A worktree cannot sign in
type: bug
priority: p2
created: 2026-09-20T12:55+08:00
parent:
area: api
resolution:
---

## Context

`pnpm dev` in a worktree serves the UI on a port of its own and the API
refuses every sign-in on it with `403 INVALID_ORIGIN`.

The Vite dev server is a different origin from the API it proxies to, so
`server.ts` adds it to Better Auth's trusted origins in development. It adds a
constant:

    export const viteDevOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

But the port is not a constant. `scripts/worktrees.mjs` gives slot *n* the
ports `3000 + n` and `5173 + n` and writes them into that worktree's `.env`
(US-135), so the UI of every worktree except the main slot is on 5174, 5175,
5176 — none of which that list names. The same happens to anyone who sets
`WEB_PORT` for any other reason, which is how this was found: two checkouts of
the product on one machine on 2026-09-20.

**The message names no port**, which is what makes it cost an hour. A person
reads "Invalid origin" on a screen they have used a hundred times, and nothing
says which origin was refused or which were allowed.

`AUTH_TRUSTED_ORIGINS` is the documented way out and it works, but a person
should not have to configure the address the script just chose for them. The
API already reads `PORT` from the environment; it should read `WEB_PORT` the
same way, for the same reason.

## Acceptance

- [ ] `WEB_PORT` is in the API's environment schema, defaulting to 5173, and
      `.env.example` and `docker-compose.yml` carry it.
- [ ] The trusted dev origins are built from it: `localhost` and `127.0.0.1`
      on that port, in development only.
- [ ] A test proves a sign-in from the worktree's own port is accepted and one
      from another port is refused, with `WEB_PORT` set.
- [ ] `AUTH_TRUSTED_ORIGINS` still adds origins in both modes, and production
      still trusts nothing on localhost.
- [ ] The refusal names the origin it refused and the ones it would accept, in
      a log line at warn level. The response body stays as Better Auth writes
      it: a stranger learns nothing from it, and this is for the person
      reading the server's output.
- [ ] `scripts/worktrees.mjs` needs no change; a fresh worktree signs in with
      no `AUTH_TRUSTED_ORIGINS` entry.

## Notes

- `apps/api/src/server.ts:279` — `viteDevOrigins`; `:288` — `trustedOrigins`.
- `apps/api/src/config/env.ts:91` — `PORT`, the shape to follow.
- `apps/api/src/auth.test.ts:740` — the two cases that pin this today.
- `scripts/worktrees.mjs:27` — `BASE` and `slotPorts`.
- The hosted repository has the same constant and the same bug: BUG-032 there.

## Log

- 2026-09-20T12:55+08:00 — Found by running both applications on one machine:
  the second UI took 5174 and every sign-in on it was refused.
