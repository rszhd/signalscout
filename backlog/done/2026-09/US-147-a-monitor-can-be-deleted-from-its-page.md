---
id: US-147
title: A monitor can be deleted from its page
type: feature
priority: p2
created: 2026-09-16T00:20+08:00
parent: US-109
area: web
resolution: shipped
---

## Context

**The owner found no way to delete a monitor.** `DELETE /api/monitors/:id`
has existed since the first monitor, and no screen called it. US-145 gave
the project a Delete button one day earlier, and a monitor made by mistake
still had to be deleted with its whole project.

**What goes and what stays.** The posts, matches and verdicts cascade from
the monitor, and the dialog says how many matches go. What the monitor spent
stays: since US-146 `api_usage` keeps its rows, so the account's month reads
the same after as before, and a trial cannot reset the fuse by deleting.

**One confirm dialog for both.** The styles US-145 wrote for the project
dialog moved into the theme as `confirm-dialog`, so the two screens ask the
same shape of question the same way.

## Acceptance

- [x] The monitor page has Delete beside Pause, behind a dialog naming the
      monitor and how many matches go with it
- [x] Confirming calls the route and the page leaves for the monitor list; a
      refusal shows the server's sentence and the page stays
- [x] The project and monitor dialogs share one set of theme styles

## Notes

Not rendered in a browser.

## Log

- 2026-09-16T00:30+08:00 — Shipped.
