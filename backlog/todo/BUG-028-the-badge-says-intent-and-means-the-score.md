---
id: BUG-028
title: The badge says intent and means the score
type: bug
priority: p3
created: 2026-09-20T08:55+08:00
parent:
area: web
resolution:
---

## Context

A match in the inbox reads **Low intent** while the panel beside it lists
**Intent 75**. Both are correct and they are about different things.

`band()` in `apps/web/src/Inbox.tsx` is called with `match.score`, the whole
match, and named after one of the five dimensions that go into it. A post
scoring 45 overall on relevance 35 and intent 75 is somebody asking urgently
about something the product does not do; US-225 made relevance gate the total
so that post cannot ride high intent into the inbox. The 45 is right, the 75
is right, and the word is wrong.

Banding on `match.intent` instead is the wrong fix: the badge would then stop
summarising the match, and this row would read *High intent* at 45.

The hosted application fixed the same lines as BUG-026 there and renamed the
bands to say what the badge is for: a strong lead, one worth reading, a weak
one. This ticket ports that decision by name.

## Acceptance

- [ ] No band label in `Inbox.tsx` contains the word "intent".
- [ ] The three labels describe the whole match, and the middle one still
      reads *Worth reading*.
- [ ] `Inbox.test.tsx` asserts the new labels at the three boundaries.
- [ ] `docs/design.md` or `labels.ts` names the labels once if a second
      surface uses them.

## Notes

- `apps/web/src/Inbox.tsx:134` — `band()`.
- Cloud repository, BUG-026, for the words chosen there.

## Log

- 2026-09-20T08:55+08:00 — Written from the cross-repository review of the
  cloud's changes since the split.
