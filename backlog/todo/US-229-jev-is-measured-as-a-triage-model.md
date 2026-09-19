---
id: US-229
title: Jev is measured as a triage model
type: spike
priority: p2
created: 2026-09-19T09:40+08:00
parent:
area: ai
resolution:
---

## Context

**TypeSafe's Jev is an evaluation model, and triage is an evaluation
question.** It answers typed Choice, Score and Boolean questions against one
shared state. Triage asks for one of three words about one item. The AI SDK
reached it on 2026-09-18 through `@ai-sdk/typesafe-ai`, and Jev is the only
model of `type: evaluation` in the AI Gateway catalog of 376.

**It is cheaper than `gpt-5.6-luna` by about eight times.** Jev bills 42
micro-dollars per million input tokens and nothing for output. Measured over
227 items it cost 43.7 micro-dollars an item against luna's 355.6.

**On the 227-item broad sample it matched luna on leads and cut the waste.**
`live:triage-score --per-cell=100 --model=gpt-5.6-sol` scored 227 items across
five platforms and thirteen monitors on 2026-09-19. Six of them score 60 or
more, which is the band the instrument calls a good lead. With the rule
described below and a confidence floor of 0.6:

| rule | keeps | matches (of 25) | leads 60+ (of 6) | wasted calls | cost |
|---|---|---|---|---|---|
| Jev, the product's rule condensed | 1 | 1 | 0 | 0 | — |
| Jev, looser question | 16 | 9 | 4 | 7 | $0.154 |
| Jev, looser + explicit-ask clause | 27 | 12 | 6 | 15 | $0.254 |
| Jev, the same + confidence floor 0.6 | 12 | 9 | 6 | 3 | $0.119 |
| `gpt-5.6-luna` | 17 | 10 | 6 | 7 | $0.234 |

**Every number above is fitted to the sample it was measured on.** The rule and
the floor were both chosen by reading these 227 items and then scored against
the same 227 items. Six real leads decide the whole comparison. This ticket
exists to replace that fit with a measurement on items nobody tuned against.

**Jev takes no system prompt, and how the question is put decides everything.**
Three mappings were tried and the spread between them is larger than the spread
between models:

- The whole of `buildTriageSystemPrompt` sent as the Choice question's
  `instructions` leaves the model near a coin flip. One clear lead answered
  `yes` at 0.44 against `no` at 0.40, confidence 0.17, and answered `no` on the
  next call. The API takes JSON for `state` and `instructions`; a 5,166-
  character block of prose written for a language model's system slot is not
  what it is built for.
- The monitor and the item as structured `state`, with the decision rule as
  short `instructions`, is what works. The same lead answers `yes` at 0.94,
  confidence 0.91.
- Dropping `triage-prompt.ts`'s *an explicit ask beats every refusal above*
  clause costs two of the six leads. A Reddit post titled "Need leads for my
  services", scored 82, was refused five times out of five without it and kept
  at confidence 0.82 with it. Both lost leads open by describing the author's
  own service and end by asking for help.

**The comment sample and the post sample want different rules, and that is the
finding US-221 could not have seen.** US-221 tightened the question from "could
this author be a person to reach?" to that plus "does anything here say they
want an answer?", and its own fixture shows the tightening helped on the 46
labelled comments. On posts the same rule keeps 1 item in 227. A founder writing
"I built a meeting-follow-up tool, launched a few weeks ago, zero signups so
far" describes a live problem and asks nothing, and the tightened rule refuses
it at confidence 0.10. Whether the product wants one rule or two is a question
this ticket raises and does not answer.

**Confidence is a signal the current stage does not have.** Jev returns a
probability for every option and its own confidence statistic. Under the
working rule the six real leads answer between 0.64 and 0.86, and a floor at
0.6 removes 15 keeps without losing a lead or a match. A floor was also tried
under the tightened rule and failed there: correct drops averaged 0.93 and
wrong drops 0.75, and no floor beat luna. The floor is only worth anything once
the rule is right.

**Nothing here can run in the pipeline yet.** `createTriager` builds a
`LanguageModel` through `createModel` and calls `generateStructured`. There is
no path from that to `experimental_evaluate`, so `live:triage-score
--triage-model=jev-latest` fails. Every measurement above was taken outside the
engine, by a script that reads the run record for the items and the scores and
calls Jev itself. That is enough to finish this spike and is not enough to ship
anything.

## Acceptance

- [ ] A held-out sample is measured: items that neither the rule nor the
      confidence floor was tuned against, either a later poll or monitors
      excluded from the 227
- [ ] The held-out sample contains more than six items scoring 60 or above, or
      the Log says plainly that it does not and that the result is still thin
- [ ] The Log holds the same table as the Context, for the held-out items, with
      Jev and `gpt-5.6-luna` side by side
- [ ] The Log answers one question in a sentence: **does Jev refuse a lead
      `gpt-5.6-luna` keeps?** With the count and the scores
- [ ] The confidence floor is named as a number, or dropped, with the reason
- [ ] The comment half is re-measured: `capture:triage` equivalent over the 50
      labelled subjects with the same rule, so a rule chosen on posts is not
      shipped without knowing what it does to comments
- [ ] The Log states whether one rule serves both, or whether posts and
      comments need two, and US-221's decision is either upheld or reopened in
      writing
- [ ] Run-to-run stability is measured under the final rule: each lead called
      five times, and the Log reports how many flipped
- [ ] The spike ends in a written go or no-go. Implementation is a separate
      ticket and this one does not do it

## Notes

- Costs money. The 227-item sol run cost $0.9719. The Jev half of it costs
  about $0.01 for all 227 items, so the classifier is the whole bill. A
  held-out run of the same size is about a dollar.
- Read [docs/instruments.md](../../docs/instruments.md) before running
  `live:triage-score`. It writes nothing to the database and its spend reaches
  no screen.
- **The run record's `excerpt` is not the excerpt.**
  `live-triage-vs-score.ts` line 514 writes `row.excerpt.slice(0, 300)` while
  the triage call it measured gets the whole post. Measuring a second model
  against the record's copy gives it a third of what the first model saw, and
  nothing says so: the field is named `excerpt`, the file parses, the counts add
  up. The first broad-sample comparison was taken that way and was worthless.
  Fetch the text from `posts`, and fail the run if a post is missing rather
  than falling back.
- The working harness is outside the repository, in the scratchpad, with the
  three rules in one file and a guard against the truncation above. It is an
  experiment and no test reads it. Moving it in is the implementation ticket's
  job, not this one's.
- `experimental_evaluate` landed in `ai@7.0.103`. This workspace pins
  `7.0.92`, so any run needs the bump.
- Two keys reach Jev. A TypeSafe key in `TYPESAFE_AI_API_KEY` is unrestricted.
  An AI Gateway key in `AI_GATEWAY_API_KEY` reaches `typesafe-ai/jev` on the
  free tier but rate-limits it hard: five calls, then a backoff that reached
  240 seconds and got through about five items every seven minutes. Both routes
  resolved to `jev-1.13.0` and agreed on 25 of 25 shared items.
- **A provider defect to expect.** TypeSafe rounds probabilities to two decimal
  places and the AI SDK checks that the chosen option holds the highest one.
  Rounding can break that: one answer came back `no` with `no` at 0.40 and
  `yes` at 0.41, and `experimental_evaluate` threw
  `AI_InvalidResponseDataError` instead of returning it. In `triage.ts` that is
  a failed call, which keeps the item, so the rule holds — but it is a thrown
  call, not a verdict, and it will recur wherever near-ties do.
- Jev is the only evaluation model in the Gateway catalog. There is no cheaper
  substitute to test the shape with, and OpenRouter does not carry it.
- `modelPrices` in `packages/engine/src/ai/provider.ts` lists `gpt-5.6-sol` at
  4,000,000 in and 20,000,000 out. The live Gateway catalog lists
  `openai/gpt-5.6-sol` at $2 and $10 per million, which matches
  `gpt-5.6-sol-fast` instead. Recorded costs for sol may be twice the real
  bill. Separate from this ticket and worth a re-read.
- `live:triage-score --dry` estimated $0.159 for the 227-item run and it spent
  $0.9719, six times. The earlier 117-item run estimated $0.080 and spent
  $0.3128. The estimator is wrong in one direction and by a large factor.
  Separate from this ticket.

## Log

- 2026-09-19T09:40+08:00 — Written after a day of measurement. The trigger was
  a question about whether Jev is available in the AI SDK; it is, through an
  official provider published the day before.

  Three things are worth carrying forward more than the headline numbers.
  **How the question is put matters more than which model answers it** — the
  spread between three mappings of the same rule is wider than the spread
  between Jev and `gpt-5.6-luna`. **The product's own rule is tuned for
  comments** and keeps 1 post in 227 when applied to posts. And **the first
  broad comparison was measured against a truncated copy of the text** and had
  to be thrown away; the Notes say how to avoid repeating it.

  Nothing was promoted. `pinned.ts` is untouched. The only file this work added
  to the repository is
  `packages/engine/src/ai/fixtures/triage-scores-gpt-5.6-sol-by-gpt-5.6-luna.json`,
  from a `capture:scores` run on the 50 labelled subjects with `gpt-5.6-sol` as
  the classifier. That fixture is worth having on its own: sol moves scores by
  up to 26 points against `gpt-5.6-luna` on the same text, which says the
  luna-scored fixture US-221 and US-222 read is noisier than it looked.
