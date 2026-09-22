---
id: US-313
title: A first patch takes thirty minutes
type: chore
priority: p2
created: 2026-09-23T05:44+08:00
parent:
area: docs
resolution:
---

## Context

A newcomer reads about 1,300 lines before a first patch: CONTRIBUTING.md,
AI_POLICY.md, AGENTS.md (326 lines), docs/map.md, docs/testing.md and, for a
connector, docs/sources.md. Each page is right for its subject. Together they
are a wall in front of the smallest change, and the repository has 8 stars,
0 forks and no pull request from outside. The rules are ready for many
contributors; the path to the first one is not.

The fix is not to cut those pages. It is one short path that says what a first
patch needs and defers the rest until the patch touches it: clone, set up,
run the suite, make one example change, open the pull request against `dev`.

## Acceptance

- [ ] CONTRIBUTING.md opens with a *First patch* section of 40 lines or fewer.
- [ ] It names only what a first patch needs: `pnpm setup`, `pnpm db:up`,
      `pnpm test`, `git commit -s`, the `dev` base, and the AI use line.
- [ ] Every other page is linked with the condition that makes it needed
      ("if you touch a connector, read …"), not as a reading list.
- [ ] A person who has not seen the repository followed the section on a clean
      machine and the Log says how long it took and where they stopped.

## Notes

- AGENTS.md stays the agent's page. This ticket is the person's path.
- US-316 makes the same path work on an empty cloud machine; the two should
  name the same commands.

## Log

- 2026-09-23T05:44+08:00 — Written from a review of the repository as an AI-assisted open-source
  project.
