---
id: US-318
issue: 72
title: Dependencies are updated by a bot
type: chore
priority: p2
created: 2026-09-23T05:44+08:00
parent:
area: tooling
resolution:
---

## Context

Nothing proposes a dependency update. Every version in the lockfile and every
GitHub Action moves only when somebody remembers. A self-hoster gives this
application keys that spend money, so a known hole in a dependency is a cost to
them, not only to the project.

## Acceptance

- [ ] Dependabot or Renovate opens pull requests against `dev` for npm,
      GitHub Actions and the Dockerfile's base image.
- [ ] Updates are grouped so that a normal week opens no more than a few pull
      requests.
- [ ] A security update is not grouped and is not delayed.
- [ ] The bot's commits pass the DCO step, or the step exempts the bot by
      name, and the Log says which.

## Notes

- The DCO check in `.github/workflows/ci.yml` runs only on pull requests from
  a fork; a bot's branch in this repository may skip it. Check before relying
  on that.
- US-319 pins actions by SHA; the bot then keeps the pins current.

## Log

- 2026-09-23T05:44+08:00 — Written from a review of the repository as an AI-assisted open-source
  project.
