---
id: BUG-008
title: The inbox crashes on a comment match
type: bug
priority: p1
created: 2026-09-06T18:12+08:00
parent: US-048
area:
resolution: shipped
---

## Context

Clicking a TikTok comment in the inbox blanked the screen, and so did filtering
to the TikTok monitor. Both are the same fault and neither is about TikTok.

US-048 added a line under a reply saying how much of its thread was read. It
reads `parentRepliesRead`, whose type is `number | null`, and guarded it with
`=== null`. **The runtime value was `undefined`**, because the API process
running at the time predated the change and sent a row without the key at all.
`undefined` is not `=== null`, so the guard passed and `.toLocaleString()`
threw. React unmounted the tree, so one missing number took down the whole
inbox rather than one line of it.

It looked like a TikTok bug because TikTok is where the comment matches are:
37 of them, against a monitor whose matches are nearly all replies. Any reply
on any platform would have done it.

**The lesson is about the boundary, not the operator.** A browser holds a build
for as long as its tab is open, and it talks to whatever API is deployed. Those
two are not the same age, and a field this screen did not exist to show
yesterday is genuinely optional however the type is written. So the three
fields are now declared optional rather than nullable: the compiler asks about
absence at every use site, which is what would have caught this before it ran.

## Acceptance

- [x] A row with the depth fields absent renders the match instead of throwing
- [x] The fields are optional in the web `Match` type, so the compiler asks
      about absence rather than trusting the API's age
- [x] A test builds a row **without** those keys, and reverting the guard turns
      it red

## Notes

- The test deliberately deletes the keys rather than setting them null. Adding
  them back to "tidy" it removes the only thing it tests.
- Nothing was wrong with the API or the database. Restarting the API would have
  hidden this until the next time a field was added.

## Log

- 2026-09-06T18:12+08:00 — Found by the owner, clicking a TikTok comment. Fixed
  in `Inbox.tsx`: `== null` rather than `=== null`, and the three fields marked
  optional so the next one cannot repeat it.
