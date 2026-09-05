---
id: US-012
title: A match is marked good or not relevant
type: feature
priority: p2
created: 2026-09-04T22:49+08:00
parent:
area:
resolution:
---

## Context

PLAN.md's feedback loop asks a long-term question: what does *this* user
consider a good lead? Different businesses value different things, and no
prompt written by us knows that.

The loop starts by collecting the answer, not by using it. Two buttons on
every match, stored with the match and the monitor. That alone is worth
shipping, because it also answers the question PLAN.md sets as the real
measure of success — are people receiving matches they find valuable? A
monitor whose feedback is nine tenths negative is a product failure that no
other metric will show.

Using the feedback is a later, harder ticket. The obvious approach — put the
marked examples into the classifier prompt as few-shot cases — is cheap and
will probably work, but it grows the prompt on every call, which costs money
on every call. That trade is not settled here.

What must be right now is the record: which user, which match, which verdict,
when, and against which version of the monitor. Feedback collected against an
edited monitor and later replayed against the new one teaches the wrong
lesson.

## Acceptance

- [ ] Every match in the inbox has a good and a not-relevant action
- [ ] A verdict is stored with the user, the match, the monitor and a timestamp
- [ ] A verdict can be changed, and the change is recorded rather than
      overwritten
- [ ] A verdict records which version of the monitor it was given against
- [ ] Marking a match not relevant removes it from the default inbox view but
      does not delete it
- [ ] Each monitor shows its counts of good and not-relevant
- [ ] Feedback is exportable as JSON, so it survives a reinstall

## Notes

- Depends on [US-011](US-011-the-inbox-shows-why-a-post-matched.md).
- PLAN.md, *Feedback loop* and *Success criteria*.
- Using the feedback to improve scoring is a separate ticket, not yet written.
  Collect first; a learning loop with no data to learn from is speculation.

## Log

- 2026-09-04T22:49+08:00 — Written from PLAN.md.
