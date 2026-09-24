---
id: US-405
title: A reply voice holds every rule
type: feature
priority: p1
created: 2026-09-25T00:03+08:00
parent:
area:
resolution:
---

## Context

**The owner found that drafts do not sell the product, and decided where the
rules belong.** The reply prompt fixed four rules no voice could override —
never open with the product, mention it at most once and preferably not at
all, never invent a fact, never claim to work anywhere — and its guidance on
"a good reply" leaned the same way. So drafts mostly left the product out,
and could not say "I built this" even when it was true. The owner's decision:
no rule is hardcoded; every rule is in the voice, where a person can read and
change it.

**What the prompt says now is only what is true**: a person will edit and
post this reply, what they sell, and the post. The voice follows under "How
to write this reply". A draft with no voice gets no rules.

**The shipped voices carry the rules**, with one change the owner asked for:
they mention the product after the answer, once, as something the person
makes ("I built X"). The disclosure is kept because communities remove
undisclosed self-promotion and Reddit's rules ask for it. They still forbid
inventing product facts, keep the `[check: …]` notes and the honest refusal,
and leave the product out with a note when it does not fit.

**Saved copies.** Every account holds its own copy of the five voices.
Migration 0072 rewrites a copy only while it still holds the old shipped
words under the old name; an edited or renamed voice is the person's.

## Acceptance

- [x] `buildReplySystemPrompt` holds no rule: the task, the product and the
      voice's words, and nothing else
- [x] Each shipped voice carries the product, honesty, uncertainty and
      refusal rules, and mentions the product after the answer with a
      disclosure
- [x] Migration 0072 rewrites untouched shipped voices and leaves edited ones
- [x] The draft panel starts on the first saved voice; *No saved prompt*
      still drafts with none
- [x] No screen or site page promises a rule the code no longer enforces

## Notes

- `packages/engine/src/ai/reply.ts`, `reply-voices.ts`;
  `packages/pipeline/drizzle/0072_*.sql`.
- The shipped text was written once, on 2026-09-07 (e33b2d2), and not
  changed since, so one old version is matched.
- The cloud application has its own draft panel; its default voice and its
  wording are a cloud ticket.

## Log

- 2026-09-25T00:03+08:00 — Built in a worktree. On the worktree's copy of the local data,
  migration 0072 rewrote all 70 untouched shipped voices across 14 accounts
  and left the one voice a person wrote. No draft was generated against a
  real model, so how drafts read with the new voices is not yet measured.
