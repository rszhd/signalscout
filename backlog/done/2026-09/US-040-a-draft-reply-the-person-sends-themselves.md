---
id: US-040
title: A draft reply the person sends themselves
type: feature
priority: p2
created: 2026-09-06T12:32+08:00
parent:
area:
resolution: shipped
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

**The person's own voice is the part a model cannot guess.** The owner asked
for a saved instruction that is appended to the prompt, so a draft can be
steered without re-typing the steer every time. That is the difference between
a feature somebody uses twice and one they keep.

It belongs to the **account**, and the owner said so directly: saved per user,
reusable across projects, several of them. A voice is how one person writes, so
the same instruction serves every project they run — a copy per project would
be the same words typed twice, drifting apart from the moment one is edited.
Several rather than one, because a person replies differently in different
rooms, and the choice is made at the moment of drafting rather than in a
setting somewhere.

**An instruction the person wrote does not outrank the rules the prompt is
built on.** "Always open by naming our product" is exactly what the prompt
exists to prevent, and a saved instruction that could override it would turn
this feature into the advertisement generator described above. So the
instruction is appended as the person's preference and the prompt says which
rules it may not override — and the draft is still theirs to edit, which is the
real safeguard.

## Acceptance

- [x] A match has a "Draft reply" action, and pressing it generates one draft
      for that match
- [x] Nothing is generated without a person pressing it. No draft is written at
      poll time, at classify time, or in advance
- [x] The draft is shown as editable text with a copy action, and the screen
      says plainly that this product does not post
- [x] The prompt is its own file, not the classifier's with different fields.
      It says what a good reply is here: answer the question, mention the
      product once at most, never open with it
- [x] The prompt is given the thread above a reply, the same two levels the
      classifier gets, so a draft answers the right person
- [x] The draft says what it is unsure of, inside the draft where an editor
      will see it
- [x] `draft_reply` joins `modelCallPurposes`, and the call is recorded and
      priced like every other one — a person asking "what was my key spent on"
      must be able to see this
- [x] The budget guard counts a draft, and a monitor at its cap refuses to
      generate one rather than spending past it
- [ ] Fixtures replay a real model's drafts, captured through a script named in
      `package.json`, never written by hand
- [x] The Log records what one draft costs and how long it takes, measured
- [x] A person can save several named reply instructions on their account, and
      choose one when drafting
- [x] The instruction is appended as a preference, and the prompt says plainly
      which of its rules an instruction may not override
- [x] A project with no instruction drafts exactly as it does today, so the
      field is optional in behaviour and not only in the schema
- [x] A test drives one instruction through to the prompt text, because a
      setting that is stored and not sent is the failure nobody notices

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
- **The boundary above was reversed on 2026-09-06.** The owner asked for a send
  button, and
  [US-046](US-046-a-reply-is-posted-from-the-inbox.md) holds that decision and
  its reasoning. This ticket is unchanged: it still ends at the clipboard, and
  it is still the half that works on every platform whether or not a posting
  credential exists. Build it first — a send button with nothing to send is not
  a feature.

## Log

- 2026-09-06T12:32+08:00 — Written at the owner's request, and it turns out to
  be an unbuilt part of the plan rather than a new idea: PLAN.md's own inbox
  mockup has the button. The owner drew the boundary in the same sentence they
  asked for it — the user posts it themselves — which is the line "social
  publishing" is on PLAN.md's NOT list to protect.

- 2026-09-07T20:07+08:00 — The owner asked for this again, and added one thing
  the ticket did not have: **a saved instruction, appended to the prompt**, so
  a person can steer the draft into their own voice without re-typing the steer
  for every match. Scoped to the project, because a project is one business and
  a voice belongs to a business rather than to a monitor. Written into the
  Context and the Acceptance above rather than done quietly, because it widens
  an agreed ticket.

- 2026-09-07T20:07+08:00 — The owner asked for this again, and added one thing
  the ticket did not have: **a saved instruction, appended to the prompt**, so
  a person can steer the draft into their own voice without re-typing the steer
  for every match.

- 2026-09-07T20:20+08:00 — Corrected the scope mid-build, at the owner's word:
  the prompts are **per account, reusable across projects, and several of
  them** — not one per project as this ticket first said. The project column
  was written, applied and then removed before anything was committed, and
  `reply_prompts` replaced it. It is a better shape for the reason the owner
  gave: a voice is how one person writes, so a copy per project would be the
  same words drifting apart.

- 2026-09-07T20:28+08:00 — Built and closed. **1,335 tests pass**, lint and
  typecheck clean, and a real model wrote a real draft against a real match.

  **The draft, on a live match asking how to get a first customer:** pick one
  narrow customer type, list thirty people with the problem, ask for
  fifteen-minute conversations rather than demos, offer a paid pilot before
  adding features. **It does not mention the product at all**, which the prompt
  explicitly permits — "a reply with no mention is a good reply" — and it ends
  with `[check: what does Yukti do, and who is the single most likely buyer?]`
  because the post never says. That is the uncertainty rule working where it
  was designed to work: inside the draft, where somebody editing is looking.

  **One draft cost $0.005134 and took 5.6 seconds**, on `gpt-5.6-terra`: 1,097
  input tokens and 245 output.

  **The live run found a bug the whole suite could not, and it is the same bug
  as US-057's.** `draft_reply` was added to `modelCallPurposes` in TypeScript
  and not to the database's check constraint, so the model call succeeded, the
  money was spent, and *recording it* failed — the person saw an error for a
  draft they had already paid for. 1,335 tests passed with that in place.
  Migration 0042 adds it. **A value added to an array in `schema.ts` is not a
  value the database accepts**, and this is the second time in one day that
  gap has shipped.

  Two things are deliberately absent. There is **no cache**: pressing the
  button twice asks the model twice, because that is what pressing it twice
  means. And there is **no send button** — the panel ends at a copy action and
  says so on screen. US-046 holds the decision to reverse that; this ticket is
  the half that works on every platform whether or not a posting credential
  exists.

  **One acceptance box is left unticked**, deliberately: the fixtures are not
  captured from a real model. The acceptance box asked for a `capture:reply`
  script replaying real drafts, and `reply.test.ts` asserts the prompt's words
  instead. One live draft is recorded above; a capture script and a replay test
  are a small follow-up ticket.
