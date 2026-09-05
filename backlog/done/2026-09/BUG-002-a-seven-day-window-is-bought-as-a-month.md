---
id: BUG-002
title: A seven-day window is bought as a month
type: bug
priority: p1
created: 2026-09-05T10:22+08:00
parent: US-005
area:
resolution: fixed
---

## Context

`dateRangeFor` picks the narrowest Bright Data range that still reaches back to
the caller's `since`. It compares `now - since` against each range's width, and
the comparison is exact.

The caller works out `since` from one clock reading. This compares it against
another, taken milliseconds later inside the connector. So "the last seven
days" arrives as seven days and a few milliseconds — one millisecond too old
for "Past week" — and falls through to "Past month".

A wider range is not free. Every record inside it is billed, and the caller's
own `since` filter then throws away everything outside the window it asked for.
The user pays for a month and reads a week.

The unit test for this passed the whole time. It froze one clock and asked for
exactly seven days, which is the one case production never produces.

## Acceptance

- [x] A `since` a few milliseconds over a range boundary picks that range, not
      the next one up
- [x] A `since` genuinely wider than a range still picks the wider one
- [x] The slack is small enough that it can never skip a whole range

## Notes

- Found by US-014's first live run, 2026-09-05, which cost $0.042. A sample of
  "flaky end to end tests" asked for seven days, was billed ten records, and
  returned no posts. The snapshot's own `discovery_input` said
  `{"keyword": "flaky end to end tests", "date": "Past month", …}` and its ten
  posts were dated 8 to 27 August.
- The same boundary is in the poll step, which passes `monitors.last_polled_at`
  as `since`. A monitor polled every day asks for a month every day.
- Five minutes of slack, against ranges a day and a week apart. What it can
  cost is a post in the last five minutes of a window's far edge. What it saves
  is four times the records.
- Proven live, both halves. See the Log.

## Log

- 2026-09-05T10:22+08:00 — Found live, fixed, and pinned with two cases: a `since` one
  second over the boundary picks "Past week", and one a day over still picks
  "Past month". The old assertion — exactly seven days, one frozen clock — is
  kept, because it is still true and it is the case that hid this.

- 2026-09-05T10:41+08:00 — Verified against Bright Data for $0.015. The same keyword,
  the same seven-day window, the same ten records:

      before   {"date": "Past month"}   10 records billed,  0 posts kept
      after    {"date": "Past week"}    10 records billed, 10 posts kept
                                        oldest 6 days, newest today

  So the connector now asks for the range it meant, and Bright Data honours it:
  every post came back inside the window. Both halves of this ticket are
  measured rather than argued.

  The cost is unchanged — ten records either way — which is the part worth
  remembering. The bug never showed up as a bigger bill. It showed up as an
  empty result, and US-014 read that emptiness as a query that costs nothing.
