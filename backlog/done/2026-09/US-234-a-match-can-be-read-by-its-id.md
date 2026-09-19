---
id: US-234
title: A match can be read by its id
type: feature
priority: p2
created: 2026-09-19T20:30+08:00
parent:
area: pipeline
resolution: shipped
---

## Context

**The inbox can show a match and cannot fetch one.** `listMatches` answers a
page under filters, `countNewMatches` answers a number, and neither takes an
id. A screen that knows which match it wants has to hope it is on the page it
already loaded.

US-235 needs it: an inbox item is getting an address, so a link somebody sends
has to open that item from any page, under any filter, whoever is reading.
Without a read by id the address resolves against whatever happens to be
loaded, and an address that opens a different item is worse than no address —
US-076's point about `/billing?checkout=done#/billing` exactly.

**It is a filter, not a second query.** `matchId` joins `InboxFilters` and
`inboxConditions` gains one line. The alternative — a function with its own
joins — is the shape `countNewMatches`'s comment warns about: *"The joins are
the page's joins for the same reason."* Two readings of one row drift, and the
one that drifts is the one nobody looks at.

**`readMatch` passes `includeNotRelevant`,** because a link is not a filter. A
person referring a colleague to a match they dismissed still means that match,
and a permalink that silently 404s on a judged item would be a bug reported as
"it works sometimes". The hidden condition stays: a hidden match is gone, not
filtered.

## Acceptance

- [x] `readMatch(db, userId, matchId)` returns the match in the same shape a
      page row has, or undefined
- [x] It returns undefined for a match belonging to another account, and the
      test says so — this is the read a stranger's link would make
- [x] It returns a match the reader marked not relevant
- [x] `matchId` narrows `listMatches` too, since it is a filter like the others
- [x] The shape comes from the page's own joins, not a second query

## Notes

- The other half is US-235 in the cloud repository. Built against this working
  copy with `packages-from-source.mjs on`, released once when both are done —
  docs/releasing.md, *While the work is in progress, nothing is cut*.
- A new export, so the release is a minor.
- `countNewMatches` shares `InboxFilters` and will accept `matchId` without
  meaning much by it. Counting one id answers 0 or 1, which is not wrong, only
  useless. Not worth a second interface to prevent.

## Log

- 2026-09-19T20:30+08:00 — Written while scoping US-235. The permalink was
  asked for as a cloud change and turned out to need this first.

- 2026-09-19T20:50+08:00 — Done. `matchId` is one line in `inboxConditions`,
  and `readMatch` is `listMatches` with that id, `includeNotRelevant` and a
  page of one.

  The shape assertion had to lose two fields. `rank` is measured against the
  clock at the moment of asking, so two calls a millisecond apart differ, and
  `cursor` carries the rank. Everything else is compared whole, and the rank is
  compared to three decimal places. That is the honest version of "the same row
  the list would have shown".

  Unreleased. `readMatch` is a new export, so the version is a minor, and
  US-235 is the other half.
