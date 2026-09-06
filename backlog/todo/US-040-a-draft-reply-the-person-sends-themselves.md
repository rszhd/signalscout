---
id: US-040
title: A draft reply the person sends themselves
type: feature
priority: p2
created: 2026-09-06T12:32+08:00
parent:
area:
resolution:
---

## Context

**PLAN.md already has this button.** Its inbox mockup shows three actions under
a match: `[Open conversation]`, `[Draft reply]`, `[Not relevant]`. Two are
built. This is the third, and it has been in the plan since the first page.

**The line it must not cross is also in PLAN.md, by name.** *Social publishing*
is on the "What we are NOT building" list, beside social-media scheduling and
full sales automation. The owner drew the same line unprompted when asking for
this: **the user posts it themselves**. So this feature ends at the clipboard.
It drafts, it never sends, and it holds no account credential for any network.

That is not a limitation to apologise for. It is what keeps this product a way
of finding conversations rather than a way of flooding them, and a person who
edits a draft before posting it writes a better reply than any model does
unattended.

**The context to write a good reply already exists, and it was expensive.** A
draft needs the post, the monitor's four answers, and — on a reply — the thread
above it. US-020 stores all of that and `ai/prompt.ts` already assembles it for
the classifier, including the parent post and the reply directly above. So this
is a second prompt over data the pipeline already holds, not a new collection
problem.

**The failure to design against is not a bad draft. It is a plausible one.**
A draft that reads well and gets a fact wrong is worse than one that reads
badly, because a person will post the first and fix the second. Two guards
follow from that, and both are cheaper than regret:

* The draft names what it is uncertain about, in the draft, where a person
  editing will see it — not in a tooltip.
* Nothing is generated automatically. A draft costs a model call and a person's
  reputation, and both should be spent on purpose. One button, one match, one
  call.

**What a good reply is here is not obvious and should not be guessed.** The
matches this product finds are people asking what others use. A reply that
opens with the product is an advertisement and will be treated as one by the
subreddit, by the commenter and by the reader. A reply that answers the question
honestly and mentions the product once, as one option among the ones the person
already named, is the thing worth generating. The prompt has to say that in
those words, the way `ai/prompt.ts` says "an expert giving advice is not a
buyer" — because a model told only to "write a reply" writes a landing page.

## Acceptance

- [ ] A match has a "Draft reply" action, and pressing it generates one draft
      for that match
- [ ] Nothing is generated without a person pressing it. No draft is written at
      poll time, at classify time, or in advance
- [ ] The draft is shown as editable text with a copy action, and the screen
      says plainly that this product does not post
- [ ] The prompt is its own file, not the classifier's with different fields.
      It says what a good reply is here: answer the question, mention the
      product once at most, never open with it
- [ ] The prompt is given the thread above a reply, the same two levels the
      classifier gets, so a draft answers the right person
- [ ] The draft says what it is unsure of, inside the draft where an editor
      will see it
- [ ] `draft_reply` joins `modelCallPurposes`, and the call is recorded and
      priced like every other one — a person asking "what was my key spent on"
      must be able to see this
- [ ] The budget guard counts a draft, and a monitor at its cap refuses to
      generate one rather than spending past it
- [ ] Fixtures replay a real model's drafts, captured through a script named in
      `package.json`, never written by hand
- [ ] The Log records what one draft costs and how long it takes, measured

## Notes

- Depends on [US-020](../doing/US-020-a-monitor-can-include-comments-and-replies.md)
  for the thread context, which is built.
- **This product never posts.** No OAuth, no write scope, no stored account
  credential for any network. `docs/secrets.md` holds read keys for data
  providers; a posting credential is a different risk and this feature does not
  create it.
- A generated reply reaching a real thread is the one place this product could
  do harm rather than waste money. Everything else it gets wrong costs a model
  call. Weigh the prompt accordingly.
- `ai/call.ts` has three outcomes and this caller inherits them. A refusal
  should reach the screen as itself — a model that declines to write a sales
  reply is telling the person something.
- Reuse `ai/config.ts`'s fallback shape if the draft wants its own model. The
  classifier is a strict reader and a draft is a writer, so the best model for
  one may not be the best for the other — but do not add the setting before
  somebody wants it.
- US-012 stores verdicts against the monitor version that earned them. A draft
  is not a verdict and must not touch that, or the feedback sample splits.

## Log

- 2026-09-06T12:32+08:00 — Written at the owner's request, and it turns out to
  be an unbuilt part of the plan rather than a new idea: PLAN.md's own inbox
  mockup has the button. The owner drew the boundary in the same sentence they
  asked for it — the user posts it themselves — which is the line "social
  publishing" is on PLAN.md's NOT list to protect.
