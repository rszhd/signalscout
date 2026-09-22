---
id: US-258
issue: 53
title: The four densest files lose their inline stories
type: chore
priority: p3
created: 2026-09-20T02:05+08:00
parent: US-247
area: packages
resolution:
---

## Context

US-247 cut the eight longest file headers and wrote the rule, and the
comment share in `packages/` stayed at 40%: headers were 2% of it. The rest
is inline, and four files carry most of it — `pipeline/src/db/schema.ts`
(1,288 comment lines of 2,091, 61%), `engine/src/sources/types.ts` (78%),
`pipeline/src/worker/collect.ts` (50%) and
`engine/src/sources/providers/apify/linkedin.ts` (50%). A column comment that
says what a column is stays; a column comment that tells the story of the
ticket that added it goes to that ticket.

This is a judgment per comment, so it is one file per sitting, with the
diff read by a person.

## Acceptance

- [ ] Each of the four files is below 35% comment lines, and every removed
      paragraph that was not already in a ticket or in `docs/history.md` is
      appended there under the file's path.
- [ ] No code changes. Tests, lint and typecheck pass.

## Notes

- Measure with the snippet in US-247's Notes.
- `Correctness-critical` headers keep their failure shape and test list.

## Log

- 2026-09-20T02:05+08:00 — Split out of US-247, which cut the headers and found the share
  is inline.
