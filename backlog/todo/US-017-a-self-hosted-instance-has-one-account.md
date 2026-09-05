---
id: US-017
title: A self-hosted instance has one account
type: feature
priority: p2
created: 2026-09-04T22:49+08:00
parent:
area:
resolution:
---

## Context

The first version runs on localhost and needs no login. The moment it runs on
a server with a public address, it holds API keys that spend the owner's money
and an inbox of their commercial research. An open port is then a real
problem.

Better Auth stores sessions in the same Postgres. No external service, which
matters: a self-hosted tool that requires a hosted identity provider is not
self-hosted.

Single account by default. A self-hoster is one person and does not want to
manage users. Teams are a hosted-tier question that PLAN.md defers, so the
schema should not fight a second user later, but no team UI is built here.

The first-run path is where these tools usually leak. A default password, or
an open signup form on a public address, gives the instance away to whoever
finds it first. So the first account is created by the person who starts the
instance, and signup closes after it.

## Acceptance

- [ ] Better Auth with email and password, sessions in the instance's Postgres
- [ ] The first run creates one account, and signup closes afterwards
- [ ] There is no default password and no default account
- [ ] Every route except login requires a session, asserted by a test that
      enumerates the routes rather than checking a sample
- [ ] Monitors, matches and credentials are scoped to an account, so a second
      user is a data change and not a rewrite
- [ ] Sessions expire, and logging out invalidates the session on the server
- [ ] The self-hosting documentation says to run behind TLS and why

## Notes

- Depends on [US-001](US-001-the-workspace-runs-with-one-command.md).
- Becomes p1 before any instance is exposed to a public address, including
  our own.
- STACK.md, *The stack*, for the choice and the reason.
- No team UI. Scope the data, defer the screens.

## Log

- 2026-09-04T22:49+08:00 — Written from PLAN.md and STACK.md.
