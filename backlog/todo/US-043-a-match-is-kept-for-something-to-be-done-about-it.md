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

- [ ] A person can save a match from the inbox, and unsave it
- [ ] Saved matches are reachable as a list, separate from the inbox
- [ ] The list survives a restart and a re-poll. A saved match that is
      re-classified under a new monitor version stays saved — the person's
      intent is theirs, the way a verdict is
- [ ] Saving is not a verdict and does not touch one. `monitors.version` must
      not move, and the feedback sample must not change shape
- [ ] A saved match whose post was deleted follows US-015's rule rather than
      inventing its own. A person who kept something is owed an explanation, not
      a blank row
- [ ] The Log answers one question: after using it, did `saved` and a `good`
      verdict ever disagree? If they never do, say so, and say whether the
      product should keep both

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
