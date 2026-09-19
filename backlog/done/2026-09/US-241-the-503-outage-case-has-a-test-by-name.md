---
id: US-241
title: The 503 outage case has a test by name
type: chore
priority: p2
created: 2026-09-20T00:56+08:00
parent: BUG-016
area: sources
resolution: shipped
---

## Context

BUG-016 stopped one platform's outage from throwing away another platform's
collection, and it was found by a SocialCrawl 503. The fix is tested through
the general error path; the 503 itself, a `SocialCrawlError` of kind
`provider`, has no case of its own.

## Acceptance

- [x] A test raises a `SocialCrawlError` of kind `provider` from one
      connector and asserts the other platform's collection is kept.
- [x] Tests, lint and typecheck pass.

## Notes

- `packages/pipeline/src/worker/collect.test.ts` holds the outage cases.

## Log

- 2026-09-20T00:56+08:00 — Split out of BUG-016 when it was closed: the rest of that ticket
  was done and this box kept it in doing/.
- 2026-09-20T01:36+08:00 — Shipped. The case drives the real SocialCrawl X connector with a fetch answering 503 and the sentence the production log recorded, so the error is the client's own SocialCrawlError of kind provider, beside a fake Reddit. Reddit's posts are stored and sent on. Watched fail: rethrowing from collect.ts's per-source catch turns it red. 45 cases in the file pass; lint and typecheck pass.
