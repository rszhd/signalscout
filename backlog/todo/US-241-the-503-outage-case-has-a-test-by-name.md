---
id: US-241
title: The 503 outage case has a test by name
type: chore
priority: p2
created: 2026-09-20T00:56+08:00
parent: BUG-016
area: sources
resolution:
---

## Context

BUG-016 stopped one platform's outage from throwing away another platform's
collection, and it was found by a SocialCrawl 503. The fix is tested through
the general error path; the 503 itself, a `SocialCrawlError` of kind
`provider`, has no case of its own.

## Acceptance

- [ ] A test raises a `SocialCrawlError` of kind `provider` from one
      connector and asserts the other platform's collection is kept.
- [ ] Tests, lint and typecheck pass.

## Notes

- `packages/pipeline/src/worker/collect.test.ts` holds the outage cases.

## Log

- 2026-09-20T00:56+08:00 — Split out of BUG-016 when it was closed: the rest of that ticket
  was done and this box kept it in doing/.
