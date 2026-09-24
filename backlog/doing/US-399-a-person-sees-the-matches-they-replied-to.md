---
id: US-399
title: A person sees the matches they replied to
type: feature
priority: p1
created: 2026-09-24T23:07+08:00
parent: US-396
area:
resolution:
---

## Context

**US-396 records a reply and gives no way to find the replies again.** A
card says *Replied* and a filter hides replied matches, but a person who asks
"what did I answer this week" has to scroll the whole inbox for badges.

**The answer is a view beside *Inbox* and *Saved*, not a filter value.** The
owner chose it over a third *Replied: Only* filter. A filter would keep the
inbox's rank, which subtracts twelve points a day, so a reply posted this
morning to an old post would sit below everything else. A replied list is a
history of what the person did, so it is ordered by when the reply was
marked, newest first — the saved list's reasoning (US-043), for the same
reason.

**It shows a replied match whatever its verdict**, as the saved list does.
Somebody who replied and then judged the lead weak still replied, and the
list is the record of that.

## Acceptance

- [x] `listMatches` and `countNewMatches` take `repliedOnly`, which keeps
      only replied matches, ignores the verdict filter, and orders the page by
      `replied_at`, newest first, with a cursor that pages without loss
- [x] The list, the count and the export accept `replied=true`
- [x] The filter bar offers a *Replied* view beside *Inbox* and *Saved* when
      the page passes it; the three are exclusive, and the order picker and
      the *Replied* filter are hidden on it
- [x] The inbox heads the view *Recently replied*, says how to fill it when
      it is empty, and takes a match off it when its mark is taken back
- [x] The site's inbox page describes the view

## Notes

- Parent: US-396, which added `replied_at`.
- `repliedView` and `onRepliedView` are optional props of `InboxFilters`, so
  a page without them keeps a two-view switch.

## Log

- 2026-09-24T23:11+08:00 — Built in a worktree on top of US-396 and US-398.
  The full suite passes (2,512 tests), with lint, typecheck and the CSS
  lint. Rendered in headless Chromium against the worktree's API: the view
  lists only the replied match, heads it *Recently replied*, hides the
  order, and fits a 390-pixel screen with no sideways scroll.
