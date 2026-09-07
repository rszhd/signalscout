---
id: US-062
title: A real model's drafts are replayed
type: chore
priority: p2
created: 2026-09-07T20:30+08:00
parent: US-040
area:
resolution:
---

## Context

**US-040 shipped with one acceptance box unticked**, and this is it. The reply
prompt is asserted by its words — `ai/reply.test.ts` checks that it forbids
opening with the product, forbids inventing facts and asks for the doubt inside
the draft — but nothing replays what a real model does with those words.

Every other prompt here has that. `ai/examples.test.ts` replays the
classifier's answers to PLAN.md's four worked examples,
`ai/triage-examples.test.ts` replays fifty triage answers, and both came from a
capture script rather than from somebody's imagination. AGENTS.md is plain
about why: **a fixture we wrote is evidence about our own schema and none about
the model.**

**One live draft exists and it is recorded in US-040's Log**: on a Reddit post
asking how to reach a first customer, the model wrote practical advice,
mentioned the product not at all, and ended with a bracketed check because the
post never said what the product does. That is one draft, on one match, with
one instruction. It is an anecdote, not a fixture.

**What a replay would catch is the prompt drifting.** The rules in
`ai/reply.ts` are a product decision — never open with the product, one mention
at most, never claim to be a customer — and a word changed in the prompt can
lose one of them without any test going red. A replayed draft is the only thing
that would notice.

## Acceptance

- [ ] A `capture:reply` script drafts against a small set of real posts and
      records the answers, named in `package.json` beside the other captures
- [ ] The set covers the cases the prompt makes promises about: a post the
      product genuinely fits, one it does not, and one where the post is too
      vague to answer
- [ ] At least one is captured twice — once with a saved instruction and once
      without — so the instruction's effect is visible rather than assumed
- [ ] A replay test asserts what the prompt's rules promise: no draft opens
      with the product, none claims to be a customer, and a vague post produces
      either a bracketed check or a refusal
- [ ] The Log records what the capture cost, and what the model did with an
      instruction that asks it to break a rule

## Notes

- Read AGENTS.md, *Commands*, before adding the script: these are instruments,
  they spend money, and each one records what it asked and what came back.
- **The model is not deterministic.** US-030 captured the same fifty items
  twice and got 21 kept then 19, so the replay asserts properties — no opening
  with the product — rather than exact wording.
- One draft cost $0.005134 on `gpt-5.6-terra`. A capture of six is about three
  cents.
- The interesting case is the last acceptance box: an instruction saying
  "always name our product first" should produce a draft that still does not.
  If it does not hold, the prompt needs strengthening and this ticket found it.

## Log

- 2026-09-07T20:30+08:00 — Written when US-040 closed with this box unticked,
  so the gap is a ticket rather than a sentence in a Log nobody re-reads.
