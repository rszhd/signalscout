---
id: US-296
title: The contributing section says what help is wanted, before what is refused
type: chore
priority: p2
created: 2026-09-22T16:06+08:00
parent:
area: docs
resolution:
---

## Context

README.md's Contributing section opens by naming the most useful
contribution as a source connector, and two lines later says "Not yet,
though." The refusal is right — PLAN.md's rule stands — but a reader who
arrived with time to give has been told the one thing they thought of is
unwanted, and nothing else.

The GitHub labels `good first issue` and `help wanted` exist and no issue
carries either. There is nothing for a newcomer to pick up.

The backlog does hold the help this project wants. US-033 is the p1 and it
is thirty human verdicts on real matches — work a user can do without
reading the code. Providers for platforms we already fetch are explicitly
welcome in docs/sources.md. Docs, fixtures captured from a provider's real
responses, a connector's edge case seen in the wild: all wanted, none named
in the section.

## Acceptance

- [ ] The Contributing section leads with a short list of what helps now:
      verdicts on real matches, a provider for an existing platform, a
      captured fixture, a doc fix. The connector rule follows it, unchanged
      in substance.
- [ ] At least five of the issues US-299 mirrors carry `good first issue`
      or `help wanted`, chosen because a newcomer can finish each in one
      evening. The label is set on the ticket file (see US-299's `labels:`
      field) so the mirror carries it, never on the issue by hand.
- [ ] CONTRIBUTING.md's *Before you write code* points at the labelled
      issues as the place to start.

## Notes

- Candidates: US-033 (verdicts), US-095 (logo in the email), BUG-013 (error
  in a closed dialog), US-243 (one Instagram comment link), US-062 (replayed
  drafts). Check each fits one evening before labelling it.
- Depends on US-299 for the issues to exist. The text changes can land
  first; the labels wait for the mirror.

## Log

- 2026-09-22T16:06+08:00 — Written from a gap review against the Postiz playbook.
- 2026-09-22T16:32+08:00 — The hand-made mirror of five issues became US-299's script; this ticket now only chooses which tickets get the newcomer labels.
