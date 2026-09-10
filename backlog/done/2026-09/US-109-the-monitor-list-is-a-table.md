---
id: US-109
title: The monitor list is a table, and a monitor has a page
type: feature
priority: p2
created: 2026-09-10T14:12+08:00
parent:
area: web
resolution: shipped
---

## Context

**One monitor takes a screen and a person has several.** `Monitors.tsx` renders
a card per monitor holding, in this order: the name, the platforms, when it
last polled, a status word, the budget refusal sentence, the missing key
sentence, the schedule sentence, what the last poll did, four spend figures, the
notification issues, the feedback ratio, a disclosure with four forms inside it,
and three actions. That is about forty lines of vertical space each. Three
monitors do not fit on one screen, and the question the list is opened with —
*which of these needs me?* — is answered by scrolling past everything that does
not.

A list answers *which one*. A page answers *what about it*. The card tries to be
both, so it is a bad list and a cramped page: the schedule, the budget and the
pre-filter are settings forms rendered inside a row of a list, and the poll
history is fetched lazily precisely because rendering it for every row would
cost fifty requests for a question nobody asked.

**Five facts decide which monitor needs attention**, and each is already on the
row or one query away. The name says which monitor. The status says whether a
person or a cap stopped it. The next run time says whether waiting is the right
thing to do. The last poll says what the last collection did, which is US-104's
whole point. And the number of matches found says whether any of it produced
anything — the one number missing today, because a card can say what a poll
returned and what the filter dropped, and never says how many leads are in the
inbox.

**The count needs a read that does not exist.** `matches` has no per-monitor
count anywhere: the inbox pages it, the monitor response carries verdicts and
filter drops, and nothing counts the rows. It is one grouped statement for the
whole list, as `verdictCounts` and `filterDropCounts` already are — a query per
row is the shape that reads fine with three monitors and stops the page with
thirty. `hidden` rows are excluded, because US-015 hides a match whose post is
gone and a count that included them would report leads that cannot be opened.

Two numbers rather than one: how many matches exist, and how many are unread.
`read_at` is already the column, and *sixty found, none read* and *sixty found,
all read* send a person to two different places.

**The detail page is not new work, it is the card's disclosure with an
address.** Everything below the five columns moves there unchanged: the
schedule, the budget, the pre-filter choice with its counts, the last
collection per platform, the recent polls, the spend, the feedback ratio, the
notification issues. The poll history stops being lazy there, because a page
about one monitor is opened to read exactly that.

**The address is `/projects/<id>/monitors/<monitorId>`.** US-076's rule: every
address is a path in `route.ts`, and a project is a segment rather than a
query. A monitor belongs to a project, so its page sits under the project's
monitors.

Pause and resume stay on the row. It is the one action a person takes *from*
the list — after reading the status column, which is the column that prompts it
— and sending them through a page first to press it is the detour this ticket
exists to remove.

## Acceptance

- [x] `/projects/<id>/monitors` renders a table with one row per monitor and
      the columns: name, status, next run, last poll, found.
- [x] The name links to `/projects/<id>/monitors/<monitorId>`.
- [x] The found column shows the number of matches this monitor holds, and how
      many are unread.
- [x] `GET /api/monitors` carries that count on every row, from one statement
      rather than one per monitor.
- [x] A hidden match is not counted.
- [x] The status filter, the search box, the project grouping and the empty
      states still work.
- [x] Pause and resume work from the row.
- [x] The monitor page shows the schedule, the budget, the pre-filter, the
      spend, the last collection, the recent polls, the feedback and the
      notification issues, and every form still saves.
- [x] The monitor page loads its poll history without anybody opening a
      section.
- [x] The account's own matches only: a monitor of another account answers 404
      on the page and appears in nobody else's count.

## Notes

- `apps/web/src/Monitors.tsx`, and the new `apps/web/src/MonitorDetail.tsx`.
- The shared types and label functions move to `apps/web/src/monitor.tsx`, so
  the list and the page say the same words about the same row.
- `packages/core/src/matches/matches.ts` holds the new count.
- `apps/web/src/styles/monitors.css` holds the table.

## Log

- 2026-09-10T14:12+08:00 — Written.
- 2026-09-10T14:45+08:00 — Built. `matchCounts` in
  `packages/core/src/matches/matches.ts` is one grouped statement, and
  `toResponse` now takes its readings as a named object rather than as nine
  positional arguments — three of them are counts, and a pair swapped by hand
  would type-check and report the filter's drops as the classifier's reads.
  The list is `MonitorTable` in `Monitors.tsx`; everything else is
  `MonitorDetail.tsx` at `/projects/<id>/monitors/<monitorId>`. The shared
  types, the status word and the poll sentence moved to `monitor.tsx`, because
  a status computed twice becomes two status words the first time somebody
  edits one of them.
- 2026-09-10T14:48+08:00 — 1,876 tests pass, and four deliberate mutations were
  confirmed to turn the suite red: counting a hidden match, pointing the row's
  link at the list, blanking a paused monitor's next-run cell, and dropping the
  unread count. **Nothing has run in a real browser** — both screens are driven
  through jsdom, which is this repository's standing gap for every screen.
- 2026-09-10T15:04+08:00 — The monitor page was redesigned around current
  activity, key figures, readable history and one settings panel. The layout
  stacks on small screens. All 1,877 tests pass. Lint, typecheck and the
  production build pass.
