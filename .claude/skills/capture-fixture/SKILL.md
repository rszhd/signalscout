---
name: capture-fixture
description: Capture or refresh a fixture from a real provider or a real model. Use when a parser, a prompt or a provider endpoint changes, or when a test needs a payload that does not exist yet. Never write a payload by hand.
---

# Capture a fixture

A fixture for someone else's API is captured, not written. The reasons are in
`docs/sources.md` and the costs in `docs/instruments.md`.

**The order is [`docs/sources.md`](../../../docs/sources.md), *Capturing one,
in order*.** Follow it there; it is written for a person and it is the same
seven steps.

Two of them are the ones that have actually gone wrong here:

- **Say the cost before you run it.** Anything over a few cents is the owner's
  call.
- **Read every file the script wrote before committing.** Three captures
  leaked a real identity past a scrubber that looked right. Fix the scrubber
  and re-capture; never hand-edit a payload.

`biome.json` excludes `fixtures/*.json` from formatting; do not format them.
