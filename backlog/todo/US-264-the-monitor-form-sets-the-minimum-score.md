---
id: US-264
title: The monitor form sets the minimum score
type: feature
priority: p2
created: 2026-09-20T09:00+08:00
parent:
area: web
resolution:
---

## Context

Every monitor has a `min_score`: the lead score a post must reach before it
becomes a match and appears in the inbox. Nothing in the product shows it, and
nothing lets a person change it. Two consequences:

- An empty inbox looks like "nothing was found" when it may be "nothing
  cleared 30". The person cannot tell those apart.
- Changing it means SQL, on a self-hosted box, against a column a screen
  should own.

The API is finished. `POST /api/monitors` accepts `minScore`, 0 to 100;
`PATCH /api/monitors/:id` accepts it too; every monitor response carries it;
`monitors.test.ts` pins all four. This is a screen.

The default stays 30. US-223 says why: a threshold set too high discards good
leads before anybody sees them, and a silent false negative is worse than a
noisy inbox. A self-hoster with a noisy inbox raises the number on their own
monitor with their own evidence. This ticket gives them the control; it does
not move the default, and it does not touch the column default in the package.

The hosted application built the same control as US-224 there. The
difference is the default: the cloud starts at 40 from its own measurements.

## Acceptance

- [ ] The monitor form has a minimum-score field on the *Schedule & budget*
      step, defaulting to 30 for a new monitor and to the saved value when
      editing.
- [ ] The field says in one sentence what the number gates and that a
      higher number hides leads before anybody sees them.
- [ ] The monitor page shows the current threshold beside the match count.
- [ ] `MonitorForm.test.tsx` sends `minScore` on create and on edit, and
      refuses a value outside 0–100 before the request.
- [ ] The inbox's empty state names the threshold when the monitor has
      collected posts and none cleared it.

## Notes

- `apps/api/src/monitors.ts:227` — `minScore` in `createBody`.
- `apps/web/src/MonitorForm.tsx:112` — the *Schedule & budget* step.
- `apps/web/src/Inbox.tsx:292` — the inbox's own `minScore` filter, which is
  a view filter and not the monitor's threshold. The two must not be confused
  on screen.

## Log

- 2026-09-20T09:00+08:00 — Written from the cross-repository review of the
  cloud's changes since the split.
