---
id: US-449
title: Intent means wanting a product, not asking for advice
type: feature
priority: p1
created: 2026-10-02T16:42+08:00
parent:
area: ai
resolution:
---

## Context

A private experiment on these packages (US-434) judged every match it had
made by hand: 497 matches from 32 products, each read against its product's
four answers and labelled a real lead, the right topic but not a buyer, the
wrong customer, or off topic.

- **46% were real leads**: 68% of those scoring 75 or more, 29% of those
  scoring 50 to 74.
- **The biggest error, 219 of 497, was the right topic but not a buyer**:
  people asking for advice, venting, or showing their own project. A laid-off
  person asking for career advice matched a job-search engine; "should I take
  the job?" matched a decision tool; "the news is depressing" matched a
  positive-news app; "which chocolate is nut-free?" matched a label scanner.
  The classifier gave these intent scores of 55 to 90.
- **Wrong customer, 23**: mostly the wrong country for a local product, and
  full-time job ads matched to a freelance collaborator.
- **Off topic, 24.**

Most of those scores came from the stronger rescoring model (US-441), not
the cheap classifier: a better model scored advice-seekers as buyers too.
The prompt's definition of intent ("is the author looking for a solution
now?") is the lever, not the model.

## Acceptance

- [x] `buildSystemPrompt`'s intent line says intent is wanting a product,
      tool or service of this kind: asking what others use or for one to be
      recommended is strong; a complaint with no question is partial; asking
      for advice, opinions, help with a life or career choice, or support is
      not, nor is venting, telling a story, or showing one's own project.
- [x] Its icpFit line says: when the ideal customer is in one place, an author
      who shows they are elsewhere (another country, its currency, its tax
      office, its software) scores 10 or less; local signs count for it; with
      no sign, judge on the rest.
- [x] The two captures (`docs/instruments.md`) run before and after on the
      pinned pair, and on the classifiers the two applications run
      (deepseek-flash, gpt-6-luna); the Log gives the leads kept and lost.
- [x] `live:triage-score` runs once on the new prompt; the Log gives its numbers.
- [x] `ai/triage-scores.test.ts`'s fixtures are captured again, not edited.
- [ ] Released; the owner decided it ships to both applications (a).

## Notes

- `packages/engine/src/ai/prompt.ts`.
- The experiment keeps the labelled matches and the round results:
  `signalscout-lookout`, `research/2026-10-02-match-judging/` (private).
- Gates were tried on paper and dropped; see the Log.

## Log

- 2026-10-02 16:42 — Opened from the experiment's judging. What it measured:

  **Rules on the judged 497, simulated on the stored parts, no calls:**

  | Rule | Real leads kept | Share real |
  | --- | --- | --- |
  | Today, bar 50 | 100% | 46% |
  | Gate on intent below 40 | 96% | 50% |
  | Gate on customer fit below 30 | 99% | 47% |
  | Bar 60 | 87% | 56% |
  | Bar 65 | 80% | 60% |

  A gate on problem fit below 30 would drop real leads: "beginner looking
  for a good free budgeting app" scored problem fit 10, because that
  product's problem statement is narrow.

  **Prompt rounds on a sample of 247 (up to 10 per product, spread across
  each product's scores), both stages as the experiment runs them —
  deepseek-flash, then gpt-6.1-sol for a post at 50 or more — with no
  signals and against the hand labels:**

  | Prompt | Real leads kept | Non-leads removed | Share real | Cost |
  | --- | --- | --- | --- | --- |
  | Today's, run again | 94/107 (87%) | 52/140 (37%) | 51% | — |
  | 1: intent is wanting a product; advice is not | 81 (75%) | 97 (69%) | 65% | $1.48 (both prompts) |
  | 2: asking how to solve the problem is intent | 92 (85%) | 58 (41%) | 52% | $0.88 |
  | 3: asking how to solve it is partial intent | 81 (75%) | 72 (51%) | 54% | $0.77 |

  Round 1 removed the most and was chosen. What it lost (18) is mostly
  people asking how to solve exactly the product's problem without naming
  one ("IELTS in a few weeks, I need advice" for an English-speaking app),
  and makers asking for feedback. Rounds 2 and 3 got some back only by
  letting most advice-seekers in again.

  With today's prompt, the rescoring model removed nothing the cheap one
  passed: 182 posts each. With an unclear definition the two models agree.

  **A customer-fit gate changed nothing in round 3**: the wrong-country posts
  scored customer fit 78 to 95. The place rule works only when the ideal
  customer names the place, and the experiment's page reading wrote "people
  who want local, platonic friends" for a US product that matches by ZIP
  code. The place belongs in the page reading; the experiment also searches
  with the place now (its US-450).

  The owner chose (a): ship the round-1 wording in the engine, for both
  applications, after the captures.
- 2026-10-02 17:14 — Built: the round-1 wording, word for word as tested.
  Captures on the fifty labelled items (the test-runner monitor, bar 30),
  triage gpt-5.6-luna's verdicts, before and after; at or above 30:

  | Classifier | asking (4) | answering (26) | neither (16) | posts (4) |
  | --- | --- | --- | --- | --- |
  | gpt-5.6-luna (pinned) | 1 → 0 | 3 → 5 | 1 → 1 | 3 → 3 |
  | deepseek-flash | 2 → 1 | 2 → 1 | 1 → 1 | 3 → 3 |
  | gpt-6-luna | 1 → 1 | 0 → 4 | 1 → 1 | 3 → 3 |

  Within drift here: the scores sit between 20 and 40, beside the bar, and
  two runs on one day differ by 2.4 points an item. The single moves that
  follow the rule: "What AI tool did you guys move to?" 23 → 44 on
  gpt-6-luna; "Can you please explain further…", a follow-up on advice,
  falls under 30 on all three. Costs: gpt-5.6-luna has no price row;
  deepseek-flash $0.029; gpt-6-luna $0.012.

  `live:triage-score` on the new prompt, gpt-5.6-terra (this instance's
  classifier), 117 stored items across 8 monitors: $0.43. Triage refused 13
  that would have matched; most are YouTube "how I grew my SaaS on Reddit"
  videos scoring 30 to 57, stories told as tutorials, which the new intent
  line does not fully hold back. No earlier run on terra to compare with.

  The fixtures are captured again; the engine suite passes (822).
