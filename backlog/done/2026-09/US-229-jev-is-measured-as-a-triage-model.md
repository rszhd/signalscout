---
id: US-229
title: Jev is measured as a triage model
type: spike
priority: p2
created: 2026-09-19T09:40+08:00
parent:
area: ai
resolution: go — promote on US-232
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

- [x] A held-out sample is measured: items that neither the rule nor the
      confidence floor was tuned against, either a later poll or monitors
      excluded from the 227
- [x] The held-out sample contains more than six items scoring 60 or above, or
      the Log says plainly that it does not and that the result is still thin
- [x] The Log holds the same table as the Context, for the held-out items, with
      Jev and `gpt-5.6-luna` side by side
- [x] The Log answers one question in a sentence: **does Jev refuse a lead
      `gpt-5.6-luna` keeps?** With the count and the scores
- [x] The confidence floor is named as a number, or dropped, with the reason
- [x] The comment half is re-measured: `capture:triage` equivalent over the 50
      labelled subjects with the same rule, so a rule chosen on posts is not
      shipped without knowing what it does to comments
- [x] The Log states whether one rule serves both, or whether posts and
      comments need two, and US-221's decision is either upheld or reopened in
      writing
- [x] Run-to-run stability is measured under the final rule: each lead called
      five times, and the Log reports how many flipped
- [x] The spike ends in a written go or no-go. Implementation is a separate
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
- The harness is in the repository now: `evals/triage`, with a provider per
  rule and a dataset build that refuses on truncated or orphaned items. US-231
  holds it and the four mistakes that shaped it. `pnpm eval:triage` is how the
  remaining boxes get measured.
- `experimental_evaluate` landed in `ai@7.0.103`. US-230 took the workspace to
  `7.0.106`, so nothing here needs a bump any more.
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
- ~~`modelPrices` lists `gpt-5.6-sol` at twice the Gateway's price.~~
  **Withdrawn on 2026-09-19.** Re-read the catalog: `openai/gpt-5.6-sol` is
  $4 and $20 per million, which is what the table says. The earlier reading of
  $2 and $10 was taken during a promotion — Vercel's changelog calls it "50%
  off a lower price" — and `sol-fast` had halved in the same way. A discount
  was mistaken for a stale table. The table holds list prices and is correct.
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

- 2026-09-19T15:05+08:00 — A held-out sample exists now, and it is the
  instance's own. `live:triage-score --per-cell=60` over 183 posts the cloud
  had already collected, triaged by `typesafe/jev-latest` and classified by
  `deepseek-flash`. Nothing in it was tuned against: the rule and the floor
  were fitted to the 227-post sample from the other database, and this one was
  drawn afterwards from different data by a different classifier.

  **It contains no item scoring 60 or above. Zero.** So the headline number —
  no lead deleted — is true and is weaker than it sounds: a sample with no
  leads in it cannot lose one. What it does say is that 171 drops carried
  nothing a careful reader would have wanted, and that the highest was 44.

  The seven drops that reached a monitor's minimum are all marketing or hiring
  posts scoring 32 to 44. The threshold admits them; triage refuses them.

  **What this still does not answer.** `gpt-5.6-luna` was not run over the same
  items, so there is no side-by-side on this data. The comment half is
  unmeasured under this rule. Run-to-run stability is unmeasured under it. And
  the question of whether posts and comments want one rule or two is untouched.
  Four boxes remain and they are the ones that decide a promotion.

  Separately, the first human verdicts in this work now exist: the owner judged
  eight matches from the live trial and called all eight good, scoring 40 to
  73, on `SignalScout5` version 1. Eight positives and no negatives cannot say
  where the boundary is, but they are the first reference here that is not a
  model's opinion of a model's opinion.

- 2026-09-19T15:35+08:00 — The comment half holds, and it was the risk most
  likely to end this. `capture:triage --provider=typesafe --model=jev-latest`
  cost $0.0021 and now runs through the engine rather than a script beside it,
  so the rule measured is the rule shipped. `capture:scores --triage-model=
  jev-latest` paired it with `gpt-5.6-sol`'s existing scores and bought
  nothing: all fifty were cached under the same prompt.

  | triage | kept | leads | top drop | junk kept | triage $ |
  |---|---|---|---|---|---|
  | `gpt-5.6-luna` | 17/50 | 3/3 | 34 | 10 | $0.0178 |
  | `jev-latest` | 15/50 | 3/3 | 34 | 8 | $0.0021 |

  Against the hand labels, which is the only place in this work where the
  reference is a person: people asking kept 3 of 4 against luna's 2 of 4,
  people answering 6 of 26 for both, neither kept 3 of 16 against 6, comments
  kept 12 of 46 against 14. It keeps one more genuine asker and half as many
  empty ones.

  The asker it refuses is `ol9yf8s`, which luna refuses too and which sol
  scores 13. The two drops that would have matched at 30 score 34 and 32 and
  are both people answering somebody else, which is the group US-030 built this
  stage to refuse. luna's own pinned run drops items up to 46.

  **One rule serves both, and US-221's decision is upheld rather than
  reopened.** The Context above worried that a rule chosen on posts would
  damage the comment sample US-221 tuned for. It does not: on the same fifty
  items, against a person's labels, this rule is better on every column than
  the one shipped. The narrower reading is that US-221 tightened the *language
  model's* prompt and this is a different question shape; nothing here says
  that tightening was wrong for the model it was written for.

  Two boxes left that decide a promotion: `gpt-5.6-luna` has still not been run
  over the same held-out posts, and run-to-run stability under this rule is
  still unmeasured.

- 2026-09-19T15:55+08:00 — The side-by-side exists. `gpt-5.6-luna` was run over
  the same held-out posts with the same classifier, and the classifications
  came from cache, so only the triage model differs. 177 items shared.

  | triage | kept | matches caught | leads lost | waste | highest drop | triage $ |
  |---|---|---|---|---|---|---|
  | `jev-latest` | 7 | 3/10 | **0** | 4 | 46 | **$0.0097** |
  | `gpt-5.6-luna` | 5 | 2/10 | **0** | 3 | 46 | $0.0665 |

  **Does Jev refuse a lead `gpt-5.6-luna` keeps? No — not one.** They disagree
  on six items of 177 and none is a lead: Jev keeps four scoring 31, 17, 2 and
  0, luna keeps two scoring 0 and 0. Both refuse the same highest-scoring item,
  at 46. On quality they are indistinguishable on this sample, and Jev costs a
  seventh as much.

  Six disagreements, all worthless, is not a quality signal in either
  direction. The cost difference is not noise.

  **The floor stays at 0.6, and the evidence against it is now worth writing
  down.** All four items Jev kept that luna dropped were the floor holding an
  unsure `no` — scoring 31, 17, 2 and 0. That is the second sample in a row
  where it has rescued only junk. It has never yet been asked the question it
  exists for, because neither sample contained a lead near the boundary. So it
  is kept as insurance that has not been tested rather than insurance proved
  useless, and the next sample that does contain a boundary lead is what
  settles it. If a third sample passes with the floor rescuing nothing, drop it
  — it costs a classification each time it fires.

  One box left before a go or no-go: run-to-run stability under this rule.

- 2026-09-19T16:15+08:00 — Stability is measured and it is clean, and the same
  run overturns what the entry above said about the floor.

  Each of the six leads from the 227-post sample called five times through
  `createTriager`, so the path is the product's. **Thirty calls, zero flips.**
  Every lead kept 5 of 5. The instability seen earlier — two leads flipping at
  confidence 0.13 and 0.15 — was a property of the weaker rule and is gone
  under this one.

  **Correcting the entry above: the floor is load-bearing, not untested
  insurance.** Two of the six leads answer `no` on all five runs and survive
  only because a `no` below 0.6 confidence keeps:

  | score | verdict, five runs | kept |
  |---|---|---|
  | 77 — "I need advice from you guys, i have a web agencay" | no, no, no, no, no | by the floor |
  | 75 — "I lean towards building stuff just to give up" | no, no, no, no, no | by the floor |

  Without the floor this rule catches four of six leads. With it, six of six.
  The earlier reading — that it had rescued only junk across two samples, and
  that a third such sample should end it — was drawn from samples that held no
  lead near the boundary, and generalised from their absence. It is wrong. The
  floor stays at 0.6 and it is the reason the lead numbers hold.

  That also re-reads the cost. The four junk items it held on the cloud sample
  are what this insurance costs: four classifications, about 2,200
  micro-dollars, to keep two leads in six that would otherwise be deleted
  silently. On `triage.ts`'s own terms that is not close.

  Nine boxes, eight done. The go or no-go is the last.

- 2026-09-19T16:25+08:00 — **Go.** `jev-latest` on the TypeSafe provider should
  replace `gpt-5.6-luna` as the pinned triage model. US-232 does the promotion;
  this spike ends here.

  Five readings, two of them against a person rather than a model, and nothing
  contradicts:

  | reading | reference | result |
  |---|---|---|
  | the owner's inbox verdicts | a person | 8 of 8 good |
  | 50 hand-labelled subjects | a person's labels | better than `gpt-5.6-luna` on every column |
  | 227-post sample | `gpt-5.6-sol` | 6 of 6 leads kept |
  | held-out 183 posts, side by side | `deepseek-flash` | neither loses a lead; Jev costs a seventh |
  | stability, 30 calls | itself | 0 flips |

  It costs 49 micro-dollars an item against 356. On the live trial it ran 545
  calls for 27,913 micro-dollars, none failed, and it removed about 55% of what
  reached it.

  **Three things this go rests on, and each is a reason it could be wrong.**

  Six leads decide every post comparison, and the owner's eight verdicts are
  all positive. Neither sample can say where the boundary is, only that nothing
  above it was lost. A sample with a lead the rule refuses has not been seen —
  which is evidence of safety and also evidence of how little has been tested.

  The rule asks US-221's older question rather than the one the language-model
  prompt asks. That is deliberate and measured, and it means the product now
  holds two slightly different ideas of a lead in two files. US-232 should say
  so where a reader will find it.

  The confidence floor is not optional. Two of the six leads answer `no` on all
  five runs and survive only because a `no` under 0.6 keeps. Promoting the
  model without the floor would catch four of six.

  **What would reverse this:** a lead refused in the live inbox, a sample where
  the floor rescues nothing while a boundary lead is present, or the comment
  numbers moving after US-221's prompt is next edited.
