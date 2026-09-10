---
id: US-108
title: Setup asks one step at a time
type: feature
priority: p2
created: 2026-09-10T14:35+08:00
parent: US-088
area: web
resolution: shipped
---

## Context

**The setup gate puts both keys on one page, and the owner asked for a
wizard.** US-088 wrote it that way on purpose and said so: "It asks for one of
each and nothing else." Two forms on one page is the smallest state in which
the product works, said all at once. This reverses that one decision, on the
owner's word. Nothing else about the gate changes.

**Two forms at once is two decisions at once.** A person on their first minute
in the product meets a provider question and a model question side by side,
and the two are unrelated: one buys the conversations, the other reads them.
Answering either needs a different account, a different website and a
different key. Read together they read as one long form, and the second half
is noise while the first is being answered.

**The step is derived, not stored.** The gate already computes both answers —
any provider ready, and the scoring job's fallback able to run — and already
re-reads them after each save. The step a person is on is therefore the first
unanswered one, with no state of its own and nothing to get out of step with
the keys. This is US-088's own rule about the gate itself, applied one level
down.

**There is no way back, and that is not an omission.** A step is answered by a
key the provider accepted and this instance stored. Going back would mean
changing or removing that key, which is the connections screen's work and not
the gate's. So a saved step is ticked on the rail and the page moves on.

**The rail already carries the path.** `setup-progress` shows the numbered
steps, ticks the answered ones and marks the current one, and below 1100px it
becomes a horizontal stepper that hides the labels of every step but the
current one. That is a wizard rail already; it was sitting beside a page that
was not a wizard.

**The last screen is a confirmation rather than a third step.** Both keys are
shown as answered and one button goes into the product. It is not counted as a
step, because the counter counts keys.

## Acceptance

- [x] The gate shows one step at a time, not both forms at once.
- [x] An account with no keys starts on the data provider step.
- [x] Saving the provider key moves the page to the model key step.
- [x] An account that already has a provider key starts on the model step.
- [x] With both keys in, the page shows both answers and the way in.
- [x] The rail says which step of how many a person is on.
- [x] The rail's horizontal form below 1100px lays out this page's two steps
      rather than the monitor form's five.
- [x] The suite, lint, typecheck and build are clean.

## Notes

- `apps/web/src/Onboarding.tsx`
- `apps/web/src/Onboarding.test.tsx`
- `apps/web/src/styles/onboarding.css`
- `apps/web/src/App.test.tsx` — `finishSetup` drives the gate.

US-088's "both forms on one page" is reversed here and its reasoning is kept in
this Context rather than deleted.

## Log

- 2026-09-10T14:35+08:00 — Written.
- 2026-09-10T14:52+08:00 — Done. The gate shows one step at a time.
  `apps/web/src/Onboarding.tsx` derives the step from the two answers it
  already had: the first unanswered one, or the confirmation when both are in.
  There is no stored step, no cursor and no way back, so the page and the keys
  cannot get out of step.

  **The rail was already a wizard rail.** `setup-progress` ticks answered steps,
  marks the current one, and below 1100px turns into a horizontal stepper that
  hides every label but the current step's. It was sitting beside a page that
  was not a wizard. Its label now says which step of how many.

  One latent fault came out with it. The shared stepper lays out
  `repeat(5, minmax(0, 1fr))`, which is the monitor form's five steps; this
  page has two and was squashing them into the first two fifths of the row.
  `onboarding.css` overrides the count.

  Tests: 15 in `Onboarding.test.tsx`, three of them new — the first step is
  asked and the second is not, a saved provider key moves the page to the model
  step, and an account that already holds a provider key starts on the model
  step. The confirmation test replaces US-088's "an answered step is shown as
  answered", which was a claim about a page that no longer exists.

  Two deliberate mutations were confirmed to turn the suite red: rendering the
  model step beside the provider step (1 failure), and a step rule that never
  stops at the model step (6, across this file and `App.test.tsx`).

  1,847 tests pass. Lint, typecheck and `pnpm build` are clean.

  **Unproven: no real browser has rendered it.** Same gap as US-088 and
  US-107. Nobody has walked the two steps on a real page.
