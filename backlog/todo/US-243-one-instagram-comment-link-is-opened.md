---
id: US-243
issue: 51
title: One Instagram comment link is opened
type: chore
priority: p3
created: 2026-09-20T00:56+08:00
parent: US-049
area: sources
resolution:
---

## Context

US-049 made Instagram the sixth platform and left two boxes for a person.
A URL we build is evidence about our own string building and none about the
platform, so somebody opens one comment link. And the Log should say what the
reel search and the hashtag search each returned, and why the connector uses
the reel search; the lean run never called the hashtag search.

## Acceptance

- [ ] Somebody opened one Instagram comment link from the inbox and it landed
      on the comment. The Log says which link and when.
- [ ] The Log says what the hashtag search returns and why the reel search is
      the one used, from a run rather than from the provider's page.

## Notes

- `packages/engine/src/sources/providers/socialcrawl/instagram.ts` builds the
  link from the provider's own `comment` endpoint.
- `node packages/engine/src/sources/providers/socialcrawl/instagram-fixtures/capture.mjs`
  spends 24 credits, or 14 with `--lean`; the lean run skips the hashtag search.

## Log

- 2026-09-20T00:56+08:00 — Split out of US-049 when it was closed: the rest of that ticket
  was done and this box kept it in doing/.
