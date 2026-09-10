---
id: US-114
title: The inbox can be ordered three ways
type: feature
priority: p2
created: 2026-09-11T01:08+08:00
completed: 2026-09-11T01:15+08:00
area: inbox
resolution: shipped
---

## Context

The inbox has one order and no way to change it. US-011's rank subtracts twelve
points a day from the score, so a 96 from three days ago sits below an 88 from
ten minutes ago. That is right for reading a queue and wrong for two questions
a person actually asks: *what arrived since I last looked*, and *what did this
monitor find this morning*. Under the rank those answers are scattered through
the list, because a fresh low score and an old high one land on the same rung.

So the inbox gains a second order — newest post first — and keeps the rank as
its default. Nothing about the rank changes.

**The date is the post's, not the row's.** It is the same date the rank decays
against and the same one the card shows, and a person joins a conversation
rather than a database row. `matches.created_at` is when we got round to
scoring it, which says more about the poll schedule than about the lead.

**The cursor is where this is not cosmetic.** Pagination is keyset on the
ordering value and the id together, and today that value is hard-coded to the
rank. A second order needs the cursor to carry whatever the page was ordered
by, so the boundary and the `ORDER BY` cannot disagree.

That is also a bug already in the tree. The saved list of US-043 orders by
`saved_at` and pages on the rank, so page two of a saved list drops every match
whose rank is above the last row's — silently, and only once somebody has saved
more than fifty. It is fixed here rather than beside here, because the fix is
the same one line of design: **one ordering value per page, chosen once, used
by the sort and by the cursor.** Leaving a known-wrong cursor next to a new
correct one is how the wrong one survives.

`cursorFor` goes with it. A cursor is a property of a row *in the ordering that
produced it*, so each row carries its own and there is no second way to build
one.

## Acceptance

- [x] `listMatches` takes an order — the rank, the score alone, or the newest
      post first — and defaults to the rank.
- [x] The newest order is by the post's date and the score order by the score
      alone, and ties break on the id so a page cannot repeat or skip a row.
- [x] A cursor issued by one order resumes that same order, for all three
      orders including the saved list.
- [x] Page two of a saved list of more than one page loses no row. This fails
      before the change.
- [x] `GET /api/matches` takes the order and refuses one it does not know.
- [x] `GET /api/matches/export` takes the same order, so the file is in the
      order the screen was in.
- [x] The inbox has a control for it beside the monitor filter, not inside the
      Filters panel: an order is not a filter and must not add to that count.
- [x] The list heading names the order in force.
- [x] The saved list does not offer the control, because it has its own order.
- [x] The order is carried into the CSV link.
- [x] `pnpm test`, `pnpm lint` and `pnpm typecheck` pass.

## Notes

- The order deliberately does not go in the address. Every filter on this
  screen is state and not a route, and one of them moving would be a separate
  decision about the whole screen.
- "Highest score, no decay" was considered and left out. Nobody has asked for
  it, and a third order is a third cursor path to test.

## Log

- 2026-09-11T01:08+08:00 — Written, from the owner's request for a date order.
- 2026-09-11T01:12+08:00 — Built it as one ordering value per page.
  `orderValue` is the single place a page's order is decided, and the sort and
  the keyset cursor both read it. Each row now carries its own cursor and
  `cursorFor` is deleted: a cursor built anywhere else is a second answer to
  the question of what a page is ordered by, and it is free to disagree.

  **The saved list was already disagreeing.** It sorted by `saved_at` and paged
  on the rank, so page two dropped every row whose rank was above the last
  row's. Nobody had seen it, because it needs more than fifty saved matches.
  The test that catches it is `pages without losing a match`, and it fails
  against the old cursor.
- 2026-09-11T01:14+08:00 — Three deliberate mutations turn the suite red: the
  boundary read against the rank rather than the page's order (three cases,
  including the saved list), the order dropped from the screen's query (three
  cases), and the order control shown on the saved list. **1,907 tests pass**,
  and lint and typecheck pass.

  `loadMore` was building its own query string beside `filterQuery`, which is
  the drift that function's own comment warns about. It reads `filterQuery` now
  and adds only the cursor and the clock — the order must reach page two or a
  ranked list is paged with a date cursor.
- 2026-09-11T01:30+08:00 — The owner read the two orders and asked for three:
  the rank, the score alone, and the date alone. That is the better shape and
  the reason is in the rank itself — it is those two facts mixed at twelve
  points a day, so a person who wants one of them unmixed had no way to ask.
  `score` is the third, and its ties are the normal case rather than the rare
  one: a score is a whole number between 0 and 100, so the id tie-break carries
  the cursor on nearly every page.

  The default is labelled **Best** rather than "Score & age", on the owner's
  word. The control has room for one word and the heading under it has room for
  the sentence that says what the word means, so neither does the other's job.
