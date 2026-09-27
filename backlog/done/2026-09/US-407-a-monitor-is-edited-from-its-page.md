---
id: US-407
title: A monitor is edited from its page
type: feature
priority: p1
created: 2026-09-25T00:29+08:00
parent:
area:
resolution: shipped
---

## Context

**The open application could not change what a monitor looks for.** The
monitor page edits the schedule, the budget, the pre-filter and the minimum
score, and its *Search performance* tab even tells a person to delete a search
that never finds a match — with no way to do it. The API has accepted edits
to the answers, the platforms, the queries and the subreddits all along. The
owner asked for them to be editable, as they are in the hosted application.

**The form is the create form, filled from the monitor.** *Edit monitor* on
the monitor page opens the same steps and ends at the search plan with *Save
changes*, because the launch step's settings are on the monitor page already.
The saved queries and subreddits are kept as they are; a platform ticked in
the edit gets a list written for it alone.

**One edit could switch the deletion check off.** A collection stopped part
way keeps its place in `source_continuations`, and a poll reads on only from
places whose key matches one of its units. After an edit that removed a
search or a platform, the old place matched nothing, so nothing ever read or
abandoned it — and `reconcile.ts` skips paid verification for a monitor with
any collection in flight. `updateMonitor` now drops the places the next poll
cannot reach. The hosted application edits monitors through the same call,
so it had the same gap.

## Acceptance

- [x] An edit that changes the queries, the subreddits or the platforms
      drops every saved place the next poll cannot reach, in both polling
      shapes, and keeps the rest
- [x] The monitor page links to *Edit monitor*
- [x] The edit form is filled from the monitor, keeps its saved plan, writes
      a list only for a platform added in the edit, and saves with `PATCH`
- [x] The site's monitors page says how to edit a monitor

## Notes

- `packages/pipeline/src/monitors/monitors.ts`: `forgetUnreachableCollections`.
- `apps/web/src/MonitorForm.tsx` (`monitorId`), `route.ts` (`editMonitor`).
- A changed answer moves `monitors.version`, as before: later posts are
  scored against the new description. Queries do not.

## Log

- 2026-09-25T00:29+08:00 — Built in a worktree. The pipeline cases cover both polling shapes;
  the form cases cover the fill, the save and a platform added in the edit.
  The edit form was not rendered in a browser.
- 2026-09-25T01:34+08:00 — Released in 0.17.0 (tag v0.17.0); the hosted application edits monitors
  through the same call and took the fix with it.
