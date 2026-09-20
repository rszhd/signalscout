---
id: US-273
title: The projects page follows the hosted one
type: chore
priority: p2
created: 2026-09-20T15:40+08:00
parent: US-272
area: web
resolution: shipped
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

**The card becomes a shared component.** The owner's direction, after the
treatment landed by copying: copying is what put the two screens' card in two
places to begin with, and the next difference would be found the same way this
one was — by looking at both. So the hosted card moves into
`@signalscout/ui` as `ProjectCard`, with the product differences as slots:
the status line, the second action, and the question's wording come from the
application. The list's grid, the page heading and the empty state stay in
each application, because those are layout.

This is the first shared component that is not a primitive, so it sets two
rules. Its stylesheet ships with it and is imported by name, rather than
growing `theme.css`, which stays about primitives. And it takes no state of
its own: the open confirmation is a prop, so a page keeps deciding which card
is asking.

## Acceptance

- [x] The delete question replaces the card's action row while it is open, and
      its two choices read *Keep* and *Yes, delete*.
- [x] *Open inbox* is the quiet pill the hosted card uses; the filled primary
      button is gone from the row.
- [x] *Delete* is a text button at the far end of the actions.
- [x] A successful delete removes the row without re-reading the list; a failed
      one keeps the row and says why above the list.
- [x] The loading state is the marked block, and the list heading says *All
      projects* with the count and one sentence about opening one.
- [x] The card still shows the monitor count and still offers *New monitor*,
      and the question still names the monitors and matches that go.
- [x] `pnpm lint:css` passes: the new rules name tokens. The hosted file's two
      raw reds do not come with them — `--danger` exists here.
- [x] `Projects.test.tsx` covers the confirmation replacing the actions, the
      row leaving on a delete, and the row staying on a failure.
- [x] `ProjectCard` is in `@signalscout/ui`, with its own stylesheet exported
      as `@signalscout/ui/project-card.css`, and takes the status, the second
      action and the delete question as props. It holds no state.
- [x] The open application renders it, and the rules that moved are gone from
      `apps/web/src/styles/projects.css`.
- [x] The card's two raw reds do not travel: `--danger` is the colour.
- [x] US-271 in the hosted repository says the card is in the package now, so
      its adoption deletes a copy rather than keeping one.
- [ ] The screen was rendered in a browser at desktop and phone widths, and the
      Log says what was seen. **Not done**: the Chrome extension is not
      connected to this session. The dev server serves the page and the card's
      stylesheet resolves from the package, but no browser has rendered it.
      The two things to look at are the audience line under a long
      description, and the delete question at phone width.

## Notes

- `apps/web/src/Projects.tsx`, `styles/projects.css`, `Projects.test.tsx`.
- Hosted: the same two files in `signalscout-cloud`, US-185 and US-207 there.
- The hosted stylesheet writes `#8f3f39` twice with a comment saying no token
  exists. One does here, `--danger`, added by US-270.

## Log

- 2026-09-20T15:40+08:00 — Asked for by the owner after the shell landed.
- 2026-09-20T15:55+08:00 — The treatment landed by copying: the question takes
  the action row, the inbox pill is quiet, delete is a text button at the far
  end, a deleted row leaves without a reload, and the loading state is the
  marked block. Three cases, and two mutations — re-reading the list instead of
  filtering it, and dropping the row on a failed delete — each went red.
- 2026-09-20T16:10+08:00 — Then the owner asked for the card itself to be
  shared, so `ProjectCard` is in `@signalscout/ui` with its own stylesheet,
  taken from the hosted version rather than this one. On the way: the two raw
  reds became `--danger`, the `.projects-content` qualifiers are gone, and the
  `.project-avatar` rule the empty state was quietly sharing became that page's
  own circle. `react-router` is a peer now — a card whose name is a plain
  anchor reloads the application on a click. This application's stylesheet
  lost every card rule; what is left is the heading, the list grid, the empty
  state and the editor. 2,254 tests pass, and the packed package still installs
  and works outside the workspace.
- 2026-09-20T16:12+08:00 — The card has no test of its own: the package has no
  DOM harness, and `Projects.test.tsx` drives the real component through the
  page. A second application adopting it (US-271) gets the same coverage the
  same way. A harness in the package is worth its own ticket if a shared
  component ever needs one without a page.
