---
id: US-315
issue: 69
title: Does a good first issue refuse a generated patch?
type: spike
priority: p2
created: 2026-09-23T05:44+08:00
parent:
area: policy
resolution:
---

## Context

AI_POLICY.md closes a generated patch on a `good first issue` without review,
so that a person learns the code. The rule comes from Ghostty. The projects this
repository takes as its model for growth — Postiz among them — are more open to
AI-assisted contributions, and this repository is itself written with an agent.
The two positions pull in different directions, and the policy should say which
one it chose on purpose.

The rest of the policy already carries the real test: the contributor explains
every line without the tool. The question is whether this one rule adds to that
test or only turns away people who would pass it.

## Acceptance

- [ ] The decision is written in AI_POLICY.md: keep the rule, drop it, or
      replace it, with the reason in one paragraph.
- [ ] CONTRIBUTING.md and the `good first issue` wording agree with it.
- [ ] If the rule is dropped, the Log says what now checks that a person
      learned the code (for example, the review questions).

## Notes

- AI_POLICY.md, *Limits*, second item.
- CONTRIBUTING.md, *Before you write code*, says the same rule.

## Log

- 2026-09-23T05:44+08:00 — Written from a review of the repository as an AI-assisted open-source
  project.
