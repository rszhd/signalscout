---
id: US-273
title: The projects page follows the hosted one
type: chore
priority: p2
created: 2026-09-20T15:40+08:00
parent: US-272
area: web
resolution:
---

## Context

The owner asked for this screen to follow the hosted application's. US-272
brought over the shell — the sidebar, the mark, the browser icons — and the
screens inside it are still each application's own (US-270). This is the first
screen to follow on purpose, and the difference between the two is not the
brand: both wear `@signalscout/ui` already. It is the treatment.

Four things the hosted card does better, and they are the reason for the
ticket:

- **The delete question replaces the actions rather than sitting under them.**
  On a narrow card two rows of unrelated controls compete for space, and a long
  project name makes the confirmation wrap under the buttons it is about.
- **Opening an inbox is a quiet pill, not a solid button.** Every row carried
  a filled primary button, so a list of six projects had six of them and none
  read as the main action.
- **Delete is a text button pushed to the far end**, away from the actions a
  person came for.
- **A deleted row leaves the list without reloading it.** Reloading moves every
  other row under a person who is usually about to do something else, and a
  failed delete must keep its row rather than making a deletion look done.

The loading state and the list heading follow too: a marked block rather than a
bare line, and a heading that says what opening a project is for.

**What does not follow, and why.** The hosted product is one monitor per
project (US-174 there), so its card shows that monitor's state, offers *View
monitor*, and names "its monitor and every match it found" in the question.
Here a project holds several monitors. So this screen keeps its monitor
**count**, keeps *New monitor* as the second action, and keeps BUG-030's
question, which names how many monitors and matches go. Following a screen is
taking its treatment, not its product decisions.

## Acceptance

- [ ] The delete question replaces the card's action row while it is open, and
      its two choices read *Keep* and *Yes, delete*.
- [ ] *Open inbox* is the quiet pill the hosted card uses; the filled primary
      button is gone from the row.
- [ ] *Delete* is a text button at the far end of the actions.
- [ ] A successful delete removes the row without re-reading the list; a failed
      one keeps the row and says why above the list.
- [ ] The loading state is the marked block, and the list heading says *All
      projects* with the count and one sentence about opening one.
- [ ] The card still shows the monitor count and still offers *New monitor*,
      and the question still names the monitors and matches that go.
- [ ] `pnpm lint:css` passes: the new rules name tokens. The hosted file's two
      raw reds do not come with them — `--danger` exists here.
- [ ] `Projects.test.tsx` covers the confirmation replacing the actions, the
      row leaving on a delete, and the row staying on a failure.
- [ ] The screen was rendered in a browser at desktop and phone widths, and the
      Log says what was seen.

## Notes

- `apps/web/src/Projects.tsx`, `styles/projects.css`, `Projects.test.tsx`.
- Hosted: the same two files in `signalscout-cloud`, US-185 and US-207 there.
- The hosted stylesheet writes `#8f3f39` twice with a comment saying no token
  exists. One does here, `--danger`, added by US-270.

## Log

- 2026-09-20T15:40+08:00 — Asked for by the owner after the shell landed.
