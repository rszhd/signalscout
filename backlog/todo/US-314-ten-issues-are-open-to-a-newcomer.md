---
id: US-314
title: Ten issues are open to a newcomer
type: chore
priority: p2
created: 2026-09-23T05:44+08:00
parent:
area: backlog
resolution:
---

## Context

README.md and CONTRIBUTING.md send a newcomer to issues labelled
`good first issue` or `help wanted`. Three of 23 open issues carry one of
them: US-243, BUG-013 (`good first issue`) and US-062, US-095, US-033
(`help wanted`, one of which is the verdicts). A person who follows the link
finds almost nothing, and the link is the main way in.

A ticket reaches a newcomer through its `labels:` frontmatter and
`backlog/sync.sh`, so this is ticket work, not GitHub work.

## Acceptance

- [ ] At least ten open tickets carry `good first issue` or `help wanted`
      in `labels:`, each with `easy` or `medium`.
- [ ] Each labelled ticket names the files to start from in **Notes** and has
      an Acceptance list a newcomer can check without asking.
- [ ] No labelled ticket needs a paid provider key to finish.
- [ ] `backlog/sync.sh --check` passes after the labels are synced.

## Notes

- Candidates may come from new tickets: US-318, US-319 (the SHA pins), one
  template each from US-320, and BUG-323.
- Whether a generated patch may take a `good first issue` is US-315. Settle
  that first, because it changes what the label promises.

## Log

- 2026-09-23T05:44+08:00 — Written from a review of the repository as an AI-assisted open-source
  project.
