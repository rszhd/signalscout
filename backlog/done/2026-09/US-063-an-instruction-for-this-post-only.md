---
id: US-063
title: An instruction for this post only
type: feature
priority: p2
created: 2026-09-07T20:45+08:00
parent: US-040
area:
resolution: shipped
---

## Context

**US-040 saves instructions and cannot use one that is not saved.** The draft
request carries a `promptId`, so the only way to steer a draft is to name a
prompt in the library. The instruction box exists, but editing it changes
nothing until the change is saved — which is the wrong way round: a person
looking at one awkward post wants to say "answer the pricing question first,
this one time" and press the button.

**So the box becomes what is sent.** The dropdown fills it from a saved prompt;
editing it after that steers this draft and nothing else; saving is a separate,
explicit act. One field, one obvious rule: *what is in the box is what the
model is told.*

That also removes a distinction the server never needed. A saved instruction
and a typed one are the same thing by the time they reach the prompt — the
person's own words — and resolving an id server-side bought nothing except a
shape that cannot express a one-off.

**The library keeps its whole job.** Saving, reusing across projects and
keeping several are all US-040's and all unchanged. What changes is that using
one no longer means committing to it.

## Acceptance

- [x] The draft request carries the instruction text, and the route no longer
      resolves a saved prompt by id
- [x] The instruction box is visible without opening anything, because a
      one-off steer is the common case and not an advanced one
- [x] Choosing a saved prompt fills the box, and editing it afterwards changes
      only this draft
- [x] The screen says plainly that an edit is for this draft unless it is saved
- [x] Saving is unchanged: a new prompt, an update to the chosen one, or a
      delete
- [x] A test drives a typed instruction through to the request, and another
      pins that editing a chosen prompt does not silently save it
- [x] `pnpm test`, `pnpm lint` and `pnpm typecheck` pass

## Notes

- The prompt's fixed rules are unaffected. `ai/reply.ts` already says which of
  them an instruction may not override, and a typed instruction is no more
  trusted than a saved one.
- `replyPromptInstruction` in core becomes unused when the route stops
  resolving ids. Remove it rather than leaving a function nothing calls.

## Log

- 2026-09-07T20:45+08:00 — Written at the owner's request, immediately after
  US-040 shipped: they want an unsaved instruction for one specific post.

- 2026-09-07T21:05+08:00 — Built and closed. 1,340 tests pass, lint and
  typecheck clean.

  **The box on the panel is what is sent.** The draft request carries
  `instruction` text and the route no longer resolves a prompt id;
  `replyPromptInstruction` went with it rather than being left as a function
  nothing calls. Choosing a saved voice fills the box, editing it steers this
  draft alone, and the dialog is still where a voice is saved, updated or
  deleted.

  **Proven against the live match.** With "Answer in exactly two sentences. Do
  not ask them anything back" typed into the box and nothing saved, the model
  returned exactly two sentences and asked nothing back. $0.005162.

  One observation for [US-062](../../todo/US-062-a-real-model-s-drafts-are-replayed.md):
  **that draft carried no `[check: …]` note**, where the same match with a
  different instruction produced one. It may be that "do not ask them anything
  back" suppressed it, which would matter — the bracketed doubt is the guard
  against a plausible-but-wrong draft, and an instruction should not be able to
  switch it off. The replay ticket should test exactly that, and this is the
  second reason it exists.

  **The panel was restyled by the owner between US-040's write and its commit**,
  and `git add -A` swept that into the same commit. Nothing was lost, but the
  first attempt at this change was applied to the older shape and broke the
  file; it was reverted to `HEAD` and reapplied against the real structure. A
  file that changed under you is a file to re-read before editing.
