---
id: US-321
issue: 75
title: Does the hosted plan charge for Slack, Discord or an API?
type: spike
priority: p1
created: 2026-09-23T05:44+08:00
parent:
area: product
resolution:
---

## Context

README.md promises that the hosted product "charges for not running a server,
never for a feature this build lacks", and backlog/README.md repeats it as a
standing decision. PLAN.md, *Possible Pro features later*, lists Slack/Discord,
API access and CRM integrations. Both cannot stay true. A contributor who offers
a Slack destination, or a public API, will ask which one holds, and the answer
should exist before the pull request does.

This decides whether US-322 (chat destinations) and a public API or MCP server
belong in this repository.

## Acceptance

- [ ] PLAN.md's Pro list agrees with the README promise, or the promise is
      changed, and one paragraph says why.
- [ ] The decision names Slack/Discord, a public API and an MCP server one by
      one.
- [ ] US-322 is moved to `todo/` or `parked/` according to the decision.

## Notes

- PLAN.md, *Possible Pro features later* (around line 499).
- The hosted repository's plan pages may name these features; this ticket
  flags that and does not change them.

## Log

- 2026-09-23T05:44+08:00 — Written from a review of the repository as an AI-assisted open-source
  project.
