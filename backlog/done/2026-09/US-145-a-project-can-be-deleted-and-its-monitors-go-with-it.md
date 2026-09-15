---
id: US-145
title: A project can be deleted, and its monitors go with it
type: feature
priority: p2
created: 2026-09-15T22:15+08:00
parent: US-045
area: web
resolution: shipped
---

## Context

**The owner found no way to delete a project.** The route exists —
`DELETE /api/projects/:id`, since US-045 — and no screen calls it. A project
made by mistake, or one made to try the product, stays on the list for ever.

**What the route does today is worse than nothing.** `deleteProject` leaves the
monitors made from the project in place with `project_id = null`. US-045 chose
that so a monitor's answers, which are its own copy, survive the project. Two
later decisions turned it into a trap. US-076 made every address name a
project, so an unfiled monitor is reachable from no screen. US-133 counts
monitors across the account, so on the instance's keys the unfiled monitor
still polls, still spends, and still fills the one slot the plan carries. A
person would delete a project to start again and find they could make no
monitor, with no way to see why.

**So a delete takes the monitors with it, and the dialog says how many.** The
`set null` on `monitors.project_id` stays, because it still describes a
monitor made before projects existed. `deleteProject` deletes the project's
monitors first, in one transaction, and the confirmation names the count, the
same way a monitor's own deletion names what it removes. The posts, matches and
verdicts under each monitor already cascade from the monitor.

## Acceptance

- [x] `deleteProject` removes the monitors made from the project, in the same
      transaction, and the core test says so where it said the opposite
- [x] A monitor made without a project, or from another project, is untouched
- [x] `DELETE /api/projects/:id` still answers 204, and 404 for a project that
      is not this person's
- [x] The projects screen offers Delete on each project, behind a dialog that
      names the project and how many monitors go with it
- [x] Confirming calls the route and the project leaves the list; the
      server's own sentence is shown when it refuses
- [x] `docs/accounts.md` or the nearest document says what a delete removes

## Notes

An account on the instance's keys that deletes its one project frees its one
monitor slot in the same request, which is the whole reason the monitors go
with it.

## Log

- 2026-09-15T23:40+08:00 — Shipped with US-146 in one commit; the two share
  the route, the screen and the dialog. Not rendered in a browser.
