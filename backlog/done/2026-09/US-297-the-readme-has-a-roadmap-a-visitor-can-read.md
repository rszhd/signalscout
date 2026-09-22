---
id: US-297
title: The README has a roadmap a visitor can read
type: chore
priority: p3
created: 2026-09-22T16:08+08:00
parent:
area: docs
resolution: shipped
---

## Context

PLAN.md and backlog/OPEN.md are the roadmap, and they are honest. They are
also written for the people building this, and a visitor who wants to know
"is X coming" finds a table of twenty-six ticket titles or a plan document
that starts from first principles.

Postiz keeps a roadmap people react to. Ours can be five lines: what is
next, what is being measured, what is refused and why, and a link to the
list for the rest.

## Acceptance

- [x] README.md has a *Roadmap* section, above the repository table, with:
      the next two or three tickets in plain words, the standing refusals
      (publishing, analytics, a seventh source until detection is proven),
      and links to PLAN.md and backlog/OPEN.md.
- [x] It is short enough that it stays true for a month without editing.
      Nothing in it names a date.
- [x] `backlog/index.sh` is not changed; the section is hand-written and
      says so.

## Notes

- Write it after US-292, so the first screen is settled and the section
  lands where the eye goes after the install.

## Log

- 2026-09-22T16:08+08:00 — Written from a gap review against the Postiz playbook.
- 2026-09-22T18:00+08:00 — Shipped. Four short paragraphs between *What this is not* and *Repository*: what is next, what is refused, how the project judges itself, and the two links for the rest. It names three ticket ids and no dates, so it stays true until those three close.
