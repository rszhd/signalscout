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

- [x] Every match in the inbox has a good and a not-relevant action
- [x] A verdict is stored with the user, the match, the monitor and a timestamp
- [x] A verdict can be changed, and the change is recorded rather than
      overwritten
- [x] A verdict records which version of the monitor it was given against
- [x] Marking a match not relevant removes it from the default inbox view but
      does not delete it
- [x] Each monitor shows its counts of good and not-relevant
- [x] Feedback is exportable as JSON, so it survives a reinstall

## Notes

- Depends on [US-011](US-011-the-inbox-shows-why-a-post-matched.md).
- PLAN.md, *Feedback loop* and *Success criteria*.
- Using the feedback to improve scoring is a separate ticket, not yet written.
  Collect first; a learning loop with no data to learn from is speculation.

### The version is narrower than "the monitor changed"

`monitors.version` counts edits to the four fields the classifier reads — the
product, the ideal customer, the problem and the signals. `ai/prompt.ts` puts
exactly those in the system prompt, so the version is the version of the
question a verdict answered.

A rename, a new poll interval, an edited query, a moved `min_score` and a moved
similarity threshold all leave it alone. They change what is collected or how
often, not what a good lead is, and a version that moved on a rename would
throw away feedback nobody has invalidated. A save with no edit leaves it alone
too: the form sends every field it holds, so the rule compares values rather
than counting keys.

### Where the two buttons are

On the match a person is reading, not on every card in the list. A card is a
line in a reading queue; the verdict is given after the post and the reasons
have been read, and buttons on every card would ask for it before.

Marking a match not relevant removes it in the browser and does not reload the
list. The rank depends on a clock, so a reload would move every other row while
somebody is reading, and the row they dismissed is the only one that changed.

### Nobody has judged a real match

Every verdict in this ticket was given against a seeded row. The inbox has
still never shown a match produced by a live classification, so no verdict has
been given on a reason a model actually wrote. What is proven is the record:
the rows, the history, the counts and the export, against real Postgres.

## Log

- 2026-09-04T22:49+08:00 — Written from PLAN.md.
- 2026-09-05T13:35+08:00 — Built the whole ticket: `feedback/feedback.ts` for the writes and
  the reads, `monitors.version` and the rule that moves it, the not-relevant
  filter inside `listMatches`, the two buttons and the dismissed filter on the
  inbox, the counts and the export link on the monitor list, and the routes for
  a verdict and an export. Migration 0011.

  Three decisions worth keeping. **A repeat of the verdict already in force
  writes nothing.** The history exists to answer "what did this person think,
  and when", and a double click recorded as a change of mind is a false answer
  to that question. **The verdict is read with the page, not by a second
  request.** The hidden filter and the verdict are the same question about the
  same rows, and a screen that asked separately could show a page whose buttons
  disagree with its list. **The export carries the superseded rows and the
  post's source and external id.** An export that held only the current answers
  would lose the part that took time to collect, and one that held only our own
  ids would mean nothing in the instance it is read back into.

  Thirteen deliberate mutations were confirmed to turn the suite red. One of
  them found a gap first: the monitor routes' counts were asserted nowhere, so
  a route that always answered zero stayed green. The screen test could not see
  it, because the screen reads a stubbed response.
  `apps/api/src/monitors.test.ts` covers both call sites now, and the mutation
  is red.
