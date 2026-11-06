---
id: US-528
title: A caller may plan each monitor's first-poll pages
type: feature
priority: p1
created: 2026-11-06T14:54+08:00
parent: US-435
area: sources
resolution: shipped
---

## Context

`firstPollPagesPerInput` is one count, or one count per platform, fixed
when the worker starts. Every monitor's first poll reads the same number of
pages of each input, whatever the monitor has to spend.

A hosted caller gives a first poll a small cap, and the cap is checked
before the poll, not during it. A first poll with many inputs can spend most
of the cap on pages, and the classifier then stops at the cap with posts
left unread. The caller knows each monitor's inputs and budget, so it can
work out a page count that leaves room for the classifier. It cannot hand
that count to the pipeline today.

So `firstPollPagesPerInput` may also be a function. The collect step calls
it once on a monitor's first poll, with the monitor's id and owner, and uses
the count it returns. `undefined` means the connectors' own caps. A returned
count outside 1 to 20 throws before any source is asked, the same rule the
fixed count keeps at start-up. Later polls are unchanged.

## Acceptance

- [x] A first poll reads the pages the function returns for that monitor.
- [x] The function is called with the monitor's id and owner, on the first poll only.
- [x] A function that returns `undefined` leaves the connectors' caps.
- [x] A count out of range from the function throws before any source is asked.
- [x] The fixed count keeps its tests and its start-up check.
- [x] `docs/pipeline.md` and the CHANGELOG say what the option now takes.

## Notes

The caller is BuyerFinder's first search (US-529 there), which plans pages
from a $0.20 budget.

## Log

**2026-11-06T15:01+08:00 — built.** `firstPollPagesPerInput` takes a
`PagePlan`. Four cases in `collect.test.ts`: the plan's pages are read and it
is asked with the monitor; a later poll does not ask it; `undefined` keeps the
connectors' caps; a count out of range from it throws with no source asked.
The pipeline suite passes (850 tests). BuyerFinder's US-529 typechecks and
passes its suite against this working copy. Not run live yet.
