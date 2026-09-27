---
id: BUG-426
title: SocialCrawl drops every Instagram comment
type: bug
priority: p1
created: 2026-09-26T02:36+08:00
parent:
area: sources
resolution: shipped
---

## Context

**Every Instagram comment SocialCrawl returns is thrown away, after it is
paid for.** `toCandidateReply` drops a comment whose `post_id` differs
from the post we asked about (the X defence in `socialcrawl/comments.ts`).
Its comment says Instagram sends `post_id` null on every comment (US-049),
so the check is inert there. That is no longer true: on 2026-09-26 the
provider sent `post_id` on every comment, and it is the reel's **shortcode**
(`DdmM_yvuoP0`), while `parentPostExternalId` is the nineteen-digit media
id (`3991935280083534836`). Every comment fails the check.

Measured in US-425: three reels, 9, 13 and 14 comments returned by the
provider, 0 kept by the connector. HikerAPI and ScrapeCreators returned the
same comments for the same reel, by id, so the comments are real. It also
explains signalscout-radar US-413, where Instagram "returned no comment".

A monitor on Instagram with replies on pays for every comment page and reads
nothing from it.

## Acceptance

- [x] A fresh capture of `/v1/instagram/post/comments` replaces the fixture
      whose comments carry `post_id: null` (the `capture-fixture` skill)
- [x] A comment is kept when its `post_id` is the post's shortcode or its
      media id, and dropped when it names another post; a test covers each
- [x] The code comment that says Instagram sends `post_id` null is removed
- [x] One live read of one reel keeps the comments the provider returned

## Notes

- `packages/engine/src/sources/providers/socialcrawl/comments.ts`,
  `toCandidateReply`; the shortcode is in the post URL, as `commentLink`
  in `instagram.ts` already reads it.
- The raw page from US-425 is in that ticket's Log, not committed.

## Log

- 2026-09-26T02:59+08:00 — Fixed. The comment parser takes the other ids a post goes by
  (`parentPostAliases`), and the Instagram connector passes the reel's
  shortcode, read from the post URL. A comment naming another reel is still
  dropped. The comment fixtures were re-captured with
  `capture.mjs --comments-url=https://www.instagram.com/reel/DPDwh4-CW8W/`,
  a new flag, so the search fixtures and the tests pinned to them stay as
  they were: 14 and 15 comments, every `post_id` "DPDwh4-CW8W", billed 5
  credits a page. Without the fix, 8 tests fail; with it, 194 pass. One live
  read through the built connector kept 14 of 14 comments (it kept 0 before).

  Spent 38 credits, about $0.31: two lean runs (14 each) before the search
  fixtures were restored, one cached run (0), one cached comments run (0),
  and the billed comments run (10). The scrubber now pseudonymises numeric
  account ids — `post.ext.author_id` had leaked in every committed
  Instagram search fixture (BUG-428). One comment names a third person in
  its text ("look like camille trinidad"), probably a public figure; the
  scrubber cannot find names in free text, and the payload is not edited by
  hand. Left for the owner to judge before this is pushed.
