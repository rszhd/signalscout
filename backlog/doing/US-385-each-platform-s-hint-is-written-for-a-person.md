---
id: US-385
issue: 99
title: Each platform's hint is written for a person
type: chore
priority: p2
created: 2026-09-23T23:09+08:00
parent:
area: web
resolution:
---

## Context

The search plan step shows a line of advice under each platform's queries.
That line was the platform's `note`, which is written for the model and is
also part of the query prompt. A person read orders meant for the model,
our own cost facts, and words such as "polling", "refused" and "replies
switched on", which name nothing on the screen. The X note repeated the word
limit that the form prints just above it. The Instagram note was about 95
words and said almost nothing about what to type.

Editing `note` would change the query prompt, and a prompt change needs
`capture:queries` again. So a person gets a separate `hint`, and the note
stays as it is.

## Acceptance

- [x] Every platform has a `hint`, and the form and the API show it in place
      of the note.
- [x] No hint repeats the word limit or the syntax rule the form states;
      `platforms.test.ts` says so.
- [x] The query prompt is unchanged.
- [x] The site's search plan section says the hints exist and names the
      replies setting.
- [ ] The hints were read on the form in a browser.

## Notes

- `packages/engine/src/sources/platforms.ts` and `types.ts`,
  `apps/api/src/monitors/form.ts`, `apps/web/src/MonitorForm.tsx`.
- The API's `/api/monitor-options` answers `search.hint` in place of
  `search.note`. The hosted repository has its own API and form, and shows
  the note until it chooses to show the hint.
- The notes still hold measurements, such as the Instagram comment ratio.
  They can move to a ticket Log when the query prompt next changes.

## Log

- 2026-09-23T23:09+08:00 — Written on the owner's review of the six notes.
  Hints added and wired through; the engine, API and form suites pass
  (1,156 tests).
