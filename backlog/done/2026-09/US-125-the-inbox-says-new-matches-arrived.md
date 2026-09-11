---
id: US-125
title: The inbox says new matches arrived
type: feature
priority: p2
created: 2026-09-11T18:48+08:00
parent:
area: web
resolution: shipped
---

## Context

**The inbox is a snapshot of the moment it loaded.** `Inbox.tsx` calls
`loadFirstPage()` once, in an effect with no timer. A monitor that polls while
somebody watches the screen writes matches nobody sees. The only way to learn
that anything arrived is to reload the page, and nothing on the screen suggests
there is a reason to.

**The question this ticket answers is which mechanism, and the answer is
neither of the two obvious ones.**

*Not a WebSocket.* The fastest schedule a monitor can have is once an hour —
`schedule.ts:80` is the top of the list, and the gaps below it were made
deliberately wide. Between two polls the inbox cannot gain a row. A socket
would hold an open connection for fifty-nine minutes of every hour to carry one
event. It also costs more than it looks: the API and the worker are separate
processes, so the worker must reach the API to push — `LISTEN/NOTIFY` or
another queue hop — and every API process must then hold per-connection state.
That is a new transport and a new fan-out path for an hourly event. The
standing decision in `backlog/README.md` asks a ticket that adds a service to
say why Postgres cannot do it. Postgres can do it. There is nothing to add.

*Not a timer on `GET /api/matches`.* Re-fetching the list would fight the
screen. The comment at `Inbox.tsx:17` already says why: the rank depends on a
clock, so every row moves on every refetch, under the cursor of the person
reading one. That is the reason a dismissed match is removed in the browser
rather than by reloading. A timer would undo that care every sixty seconds.

**So: poll a counter, and let the person choose when the list moves.** A
number is cheap to compute, cheap to send, and cannot reorder anything. The
screen shows a banner saying how many arrived. The list reloads when the banner
is clicked, and at no other time.

**The count must be scoped like the list it describes.** BUG-009's lesson
applies directly — a new read on a scoped route is a new place to leak another
account's numbers, and a count leaks quietly, because a wrong number looks
exactly like a right one. It also has to carry the same filters as the list, or
it will announce matches the reader's filters would hide.

## Acceptance

- [x] `GET /api/matches/count` answers with one number, taking the same
      filters as `GET /api/matches`: monitor, project, minimum score, saved,
      and whether dismissed matches are included
- [x] It counts only matches after a `since` instant the caller passes, so the
      answer is what arrived and not what exists
- [x] It is scoped to the session's own account: 401 without a session, and a
      monitor or project belonging to another account counts nothing
- [x] A test holds the count and the list against the same data and the same
      filters, and fails if the two disagree
- [x] The inbox asks for the count every 60 seconds while the tab is visible,
      and once more when the tab regains focus
- [x] It asks for nothing while the tab is hidden
- [x] A count above zero shows a banner saying how many matches arrived
- [x] No row enters, leaves or moves in the list until the banner is clicked
- [x] Clicking the banner reloads the first page and clears the banner
- [x] The banner's number does not count matches the reader's own actions
      created or removed
- [x] A failed count request changes nothing on the screen and is not shown as
      an error — the list on screen is still correct

## Notes

- The instant to compare against is `matches.created_at`, not
  `posts.posted_at`. A poll can classify a post written last year, and the
  reader cares about when the row appeared, not when the post did. `asOf` on
  the list route is a ranking clock and is a different thing; do not reuse it
  as `since`.
- `listMatches` in `packages/core/src/matches/matches.ts` owns the filters. The
  count belongs beside it, sharing the same filter construction, or the two
  will drift apart on the next filter added.
- The 60-second interval is a guess, not a measurement. It is far below the
  hourly poll rate on purpose: the cost of being early is one query, and the
  cost of being late is a person staring at a stale screen.
- The count query is unmeasured. It will be fast on the data any instance has
  today, and nobody has run it against a large match table.
- `document.visibilityState` is the gate. A laptop with the tab open for a week
  must not send 10,000 requests.
- If poll rates ever drop below about five minutes, or if a second person's
  verdict must appear live in somebody else's inbox, reopen the transport
  question. Neither is true now.

## Log

- 2026-09-11T18:48+08:00 — Written after the owner asked whether the inbox
  should poll or use a WebSocket. The answer is in Context: neither, because
  the event is hourly and the list must not move on its own. Nothing is built.
- 2026-09-11T20:47+08:00 — The backend half is built. `countNewMatches` in
  `packages/core/src/matches/matches.ts` and `GET /api/matches/count`. The
  four route and count boxes are done; the seven screen boxes are untouched,
  and nothing on the inbox has changed.

  The filters are shared rather than copied, which was the part worth doing
  carefully. `inboxConditions` was extracted out of `listMatches`, so the count
  and the page are narrowed by one set of lines, and the route's query schema
  is `query.pick(...)` rather than a second list of fields. The count query
  keeps the page's joins, `posts` included. It drops nothing today — a match's
  post is `not null` and cascades — but the agreement between the two reads is
  the whole claim, so the two queries stay the same shape.

  **1,980 tests pass**, 19 of them new. Five deliberate mutations were applied
  to the count and each was caught by the test that names it: `gt` widened to
  `gte` on the boundary, `since` read from `posts.posted_at` instead of
  `matches.created_at`, the shared filters dropped, the verdict join reading
  another person's feedback, and the account scope removed.

  The last of those found something older than this ticket. Removing
  `monitors.user_id` from the conditions broke no existing *list* test — every
  case in that file belonged to one account, so `listMatches` had no assertion
  on its own scoping. That is the BUG-009 shape, one layer down. A second
  account was added to the file and the list now has that case.

  Nothing has run in a browser, and the count query is still unmeasured against
  a large match table.
- 2026-09-11T21:55+08:00 — The screen is built, and every box is true against
  the suite. A 60-second interval that asks nothing while the tab is hidden and
  once more the moment it comes back, and a banner that reads `Show 3 new
  matches`. The banner is the only thing that reloads the list.

  The live region is present and empty rather than appearing with its message.
  A region added to the document at the same instant as its content is
  announced by nothing, so `.inbox-arrived-slot` is always in the tree and
  takes no room until it holds a button.

  `page.asOf` is what the count is asked against. It is already the instant the
  list on screen was read, and it already survives paging, so the screen needed
  no second clock. The order is deleted from the count's query — the route
  would strip it, but sending a filter to a route that has no use for it is a
  claim that it matters.

  **1,991 tests pass**, 30 of them new across the three layers. Six more
  deliberate mutations were applied to the screen and each was caught: the
  visibility guard removed, the order left on the request, the banner not
  cleared on a re-read, a failed count reaching the error state, the clock
  replaced by a fixed one, and the timer re-reading the list instead of the
  count. The last is the failure this ticket exists to prevent, and it turned
  six cases red.

  **No browser has rendered any of this.** The banner, its wrap at 320px and
  its contrast are asserted by jsdom and by nothing else. The count query is
  also still unmeasured against a large match table.
- 2026-09-11T22:03+08:00 — It has run in a browser. `pnpm preview` on this
  working tree, the inbox of a project with real matches open, and one match
  written straight into the dev database at 21:59:54. The banner appeared
  within the minute, the list did not move, and clicking it re-read the list
  and cleared the banner. The owner read it on the preview link and said it
  works. The two rows written by hand were deleted afterwards.

  What was **not** proven: I could not drive this myself. The app asks for an
  account after the site password, and the way to get one without asking is to
  read a session token out of the database, which is credential handling and
  was refused. So the arrival was triggered by me and read by a person, and no
  automated check covers the rendered screen.

  The count query also remains unmeasured against a large match table. It is
  fast on the 261 matches this dev database holds, which is not evidence about
  a large one.
