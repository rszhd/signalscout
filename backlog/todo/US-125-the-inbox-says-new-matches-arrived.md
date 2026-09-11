---
id: US-125
title: The inbox says new matches arrived
type: feature
priority: p2
created: 2026-09-11T18:48+08:00
parent:
area: web
resolution:
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

- [ ] `GET /api/matches/count` answers with one number, taking the same
      filters as `GET /api/matches`: monitor, project, minimum score, saved,
      and whether dismissed matches are included
- [ ] It counts only matches after a `since` instant the caller passes, so the
      answer is what arrived and not what exists
- [ ] It is scoped to the session's own account: 401 without a session, and a
      monitor or project belonging to another account counts nothing
- [ ] A test holds the count and the list against the same data and the same
      filters, and fails if the two disagree
- [ ] The inbox asks for the count every 60 seconds while the tab is visible,
      and once more when the tab regains focus
- [ ] It asks for nothing while the tab is hidden
- [ ] A count above zero shows a banner saying how many matches arrived
- [ ] No row enters, leaves or moves in the list until the banner is clicked
- [ ] Clicking the banner reloads the first page and clears the banner
- [ ] The banner's number does not count matches the reader's own actions
      created or removed
- [ ] A failed count request changes nothing on the screen and is not shown as
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
