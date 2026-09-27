---
id: BUG-428
title: Committed fixtures carry numeric account ids
type: bug
priority: p2
created: 2026-09-26T02:59+08:00
parent:
area: sources
resolution:
---

## Context

**A numeric account id names a person as surely as a handle, and several
committed fixtures still hold them.** Found while re-capturing for BUG-426:
SocialCrawl puts the creator's Instagram account id at `post.ext.author_id`,
outside any object the scrubbers treat as a person, so none of them replaced
it. The Instagram scrubber now does (`capture.mjs`, BUG-426), but the
Instagram search fixtures committed before it still carry 30, and the same
field is in these, captured by other scripts:

- `socialcrawl/tiktok-fixtures/search-keyword.json`, `search-top.json`,
  `search-page-2.json`, `search-spoken.json`
- `scrapecreators/tiktok-fixtures/search-page-whole.json`

The ids are also in the repository's history, which a new commit does not
remove.

## Acceptance

- [ ] Every capture script's scrubber pseudonymises `author_id`, `authorId`,
      `owner_id` and `user_id`, wherever they sit
- [ ] The affected fixtures are re-captured, not edited by hand, and a search
      of every committed fixture finds no numeric account id
- [ ] The owner decides whether the history is rewritten; the Log records it

## Notes

- `grep -rn '"author_id": "[0-9]' packages/engine/src/sources/providers/*/*-fixtures/`
- Re-capture costs are in `docs/instruments.md`, *The captures*.

## Log
