---
id: BUG-030
title: Deleting a project leaves its monitors polling with no inbox
type: bug
priority: p2
created: 2026-09-20T08:58+08:00
parent:
area: api
resolution: shipped
---

## Context

`DELETE /api/projects/:id` exists and nothing on a screen calls it. So a
business typed once is on the list for ever: the test one, the one that was a
mistake, the client who left.

The route is also wrong for the product as it stands. Its comment says "the
monitors made from it stay, unfiled", and `monitors.project_id` is
`onDelete: "set null"`. That was true when a monitor was made on its own and a
project was a set of answers it copied. US-045 made the inbox project-scoped:
an unfiled monitor has no inbox that can reach it, no screen that lists it,
and it keeps polling on the person's own keys. On a self-hosted instance that
is a leak of the person's money into rows nobody can read.

Deleting the project has to take its monitors with it. That is irreversible
in a way a person must see before they press it: the monitors, their polls,
and every match and verdict they hold. So the card asks once, in place, the
way the reply voice editor does.

The hosted application made the same change as US-207 there, for one monitor
per project. Here a project may hold several, so the confirmation names how
many.

## Acceptance

- [x] `DELETE /api/projects/:id` deletes the project's monitors, their polls,
      their stage runs, and their matches in one transaction; a test proves
      no row of theirs survives.
- [x] A monitor of another project is untouched by the same call; a test
      proves it.
- [x] The projects screen offers a delete on each card; it asks once, in
      place, and names the number of monitors and matches that will go.
- [x] The scheduler does not poll a deleted monitor; a test proves the
      queued job is gone or refused. `findDueMonitors` reads `monitors`, so
      a deleted one is never due; `collect.test.ts`, "does nothing when the
      monitor was deleted between the tick and the job", already proves a
      job in flight does nothing. No new test was needed for it.
- [x] The route comment that says monitors stay unfiled is gone.

## Notes

- `apps/api/src/projects.ts:294` — the route.
- `packages/pipeline/src/projects/projects.ts:176` — `deleteProject`, which
  deletes the row only. The cascade may belong here, in the package, since
  the tables are the pipeline's. If so this is a package change plus a
  release, then a pin here.
- `packages/pipeline/src/db/schema/monitors.ts:126` — `onDelete: "set null"`.
- `apps/web/src/ReplyVoices.tsx` — the in-place confirm to copy.

## Log

- 2026-09-20T08:58+08:00 — Written from the cross-repository review of the
  cloud's changes since the split.
- 2026-09-20T09:40+08:00 — Shipped. The cascade lives in the route, not in
  the package: `deleteProject` in the pipeline still deletes one row, and
  the route deletes the person's monitors and then the project in one
  `db.transaction`, with the monitors' own rows going by the schema's
  cascades. The package's `deleteProject` and `deleteMonitor` take a
  `Database` and not a `Queryable`, so the route writes the two deletes
  itself rather than widening a package signature for one caller. The
  list, the single read and the update now carry `matchCount`, which the
  card's confirmation names. Two API cases and three screen cases; three
  mutations (monitor delete unscoped, monitor delete missing, request
  never sent) each went red under one case. 328 API and 348 web tests
  pass. No browser has rendered the card. `projects.css:93` carries a
  stylelint error from before this ticket, left as found.
