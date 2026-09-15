---
id: US-142
title: One key source at a time, and the state picks it
type: bug
priority: p1
created: 2026-09-16T02:10+08:00
parent: US-141
resolution: fixed
area: core
---

## Context

**US-141 reversed US-132 too far, and the owner found it on the screen.** They
asked why a provider key could still be pasted while the account was on
SignalScout's keys. The honest answer was worse than the question: the key was
not merely accepted, it was **used**. `credentialsFromStore` reads the table
first and the environment second, always, and US-141 had removed the one branch
that said otherwise.

Three things followed, and each is a rule this repository states somewhere
else.

**It was a mix, which the owner ruled out in one sentence.** An account on our
keys polled Reddit on its own key and X on ours.

**The ledger stamped the wrong payer.** The row carries `key_source` from the
account's state, so a call their key paid for was recorded as ours and counted
against our fuse — the exact fault US-141 added the column to prevent, in the
other direction.

**The Models screen said something untrue.** It told a person a key they added
would run only once they switched. It ran at once.

**The fix is the branch US-141 should have kept.** US-132 refused two different
things — *storing* a key and *using* one — and only the first was the owner's
to reverse. On this instance's keys the store is not read at all; on its own,
only the store is. A key the account pasted is kept and unused, which is not
the "stored and ignored" shape `credentials.ts` warns about: the account can
see which state it is in and move between them in one press.

## Acceptance

- [x] On this instance's keys, a stored provider key is not read. The
      environment is the only source
- [x] On its own keys, the stored rows are the only source: a platform with no
      key of the account's does not run, rather than falling back to ours
- [x] The same for model rows, in one core function both composition roots
      call, so the worker and the API cannot disagree
- [x] Nothing is deleted either way, and the switch takes effect on the next
      call: a kept key runs the moment the account moves
- [x] The ledger stamps the payer correctly, because the state and the source
      now agree
- [x] The connections screen and the Models screen say what actually happens:
      a saved key is kept and not used until the account switches
- [x] No test spends money. 2,248 pass

## Notes

- `worker/runtime.ts`'s `credentialsForAccounts` is the provider half and
  `ai/settings.ts`'s `readAiEnvironmentFor` is the model half. Neither file
  knows what a plan is; `accountKeys.spendsInstanceMoney` is the question.
- The rule to hold on to: US-132 refused *storing* and *using*, and those are
  separable. Reversing a ticket means naming which half.

## Log

- 2026-09-16T02:10+08:00 — Written and fixed in one sitting. The owner asked
  why a key could be pasted on our keys; the field was the visible half, and
  the invisible half was that the key was being spent.
