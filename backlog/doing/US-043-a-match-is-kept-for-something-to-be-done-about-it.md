---
id: US-043
title: A match is kept for something to be done about it
type: feature
priority: p2
created: 2026-09-06T12:36+08:00
parent:
area:
resolution:
---

## Context

**`matches.saved` exists and nothing writes it.** The column is there with a
default of false, the API returns it on every match, and there is no route to
set it and no button to press. The same shape as the poll interval in
[US-041](US-041-a-person-chooses-when-a-monitor-runs.md): a column somebody
added for a screen that was never built.

**A person reads a match and cannot do anything with it except judge it.** The
inbox has three actions today — open the conversation, mark it good, mark it not
relevant. Two of those are a verdict about the model and the third is a link
away. Nothing keeps a match for later, and "later" is where the work is: a
conversation worth answering is rarely worth answering in the ten seconds after
finding it.

**The sharp question is what this is that a verdict is not**, because the
product already has two ways to mark a match and adding a third without deciding
gives it three half-used flags.

`good` is a **judgement about the model**: was this worth showing me. US-012
stores it against the monitor version that earned it, and its Log is explicit
that verdicts are collected and not yet used for anything. Saving is a
**statement about intent**: I am going to do something here. They come apart in
both directions — a match can be a good catch that needs no reply, and a weak
match can be the one you want to answer.

If they do not come apart in practice, this product needs one flag and not two,
and finding that out is part of the ticket rather than something to assume.

**"Further action" points at a feature that is already written down.**
[US-040](US-040-a-draft-reply-the-person-sends-themselves.md) is the draft
reply, and PLAN.md's inbox mockup has had that button since page one. Saved →
draft → post it yourself is the whole workflow, and this ticket is its first
step. So a saved list should be somewhere a person works through, not a second
inbox to read.

**What it should not become.** Not tags, not folders, not a pipeline with
stages. PLAN.md's NOT list has *CRM platform* on it, and a saved list that grows
statuses is a CRM growing out of an inbox. One flag, one list, and a person who
wants more says so.

## Acceptance

- [x] A person can save a match from the inbox, and unsave it
- [x] Saved matches are reachable as a list, separate from the inbox
- [x] The list survives a restart and a re-poll. A saved match that is
      re-classified under a new monitor version stays saved — the person's
      intent is theirs, the way a verdict is
- [x] Saving is not a verdict and does not touch one. `monitors.version` must
      not move, and the feedback sample must not change shape
- [x] A saved match whose post was deleted follows US-015's rule rather than
      inventing its own. A person who kept something is owed an explanation, not
      a blank row — inherited rather than written: `matches.hidden` and the
      deletion job are upstream of both lists, so a kept match follows the same
      rule with no code of its own
- [ ] The Log answers one question: after using it, did `saved` and a `good`
      verdict ever disagree? If they never do, say so, and say whether the
      product should keep both — **open, and it needs use rather than code.
      Nothing has been saved yet because nothing could be until now**

## Notes

- The column exists, so the migration may be nothing. Check before assuming
  otherwise.
- `apps/api/src/matches.ts` has one write route today, `/:id/verdict`. This is
  the second, and it should look like the first.
- The inbox already reads `saved` on every match and ignores it, so the screen's
  data is there.
- US-011 orders the inbox by score and age together, subtracting twelve points a
  day. A saved list must not inherit that: something kept on purpose does not
  get less kept overnight. Order by when it was saved.
- Do not build this and [US-040](US-040-a-draft-reply-the-person-sends-themselves.md)
  as one ticket. Saving is cheap and certain; a generated reply is a model call
  and a person's reputation. They belong to the same workflow and not to the
  same commit.

## Log

- 2026-09-06T12:36+08:00 — Written after the owner asked for it. The column was
  already there and unused, which is the second one found today. The question
  worth answering while building it is whether `saved` and a `good` verdict are
  really two things — a judgement about the model and a statement of intent —
  or one thing wearing two names.

- 2026-09-06T12:44+08:00 — Built. The migration was not nothing, which is the
  finding worth carrying.

  **The column could not do what the ticket asked.** `matches.saved` was a
  boolean, and the ordering rule — a list ordered by when things were put on it
  — needs a time. So `saved_at` replaces it rather than joining it: two columns
  that must agree is a bug waiting, and the boolean was false on all 52 rows in
  the only database that has ever run this, so the migration lost nothing. The
  API still reports `saved` as a boolean, derived, because a screen asking "is
  this kept" should not have to know about a timestamp.

  **The ordering is the whole point and it is now proven.** A test saves a
  40-scored match after a 95-scored one and asserts the 40 comes first. The
  inbox would rank them the other way every time, and US-011's twelve points a
  day would push the older one down further each night. Something kept on
  purpose does not get less kept overnight.

  **Saving twice does not move a match.** `coalesce` keeps the first time, so a
  person on a slow connection who presses a button they already pressed does not
  reshuffle a list they are working down.

  **A kept match stays on the saved list after a `not_relevant` verdict.** That
  is the case that decides these are two flags rather than one: somebody who
  judged a match weak and kept it anyway meant both, and hiding it would
  overrule them. The inbox still hides it, as it always did.

- 2026-09-06T12:44+08:00 — One test was green for the wrong reason and is worth
  writing down. The screen's fetch mock had no route for `/saved`, so the click
  threw, `keep()` caught it and set an error, and the assertion — that the
  request was made — passed anyway. The route is mocked now and the test also
  asserts the button says "Saved" afterwards, which only happens on success.
  Checking why a test passed found it; running it did not.

