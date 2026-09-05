---
id: US-011
title: The inbox shows why a post matched
type: feature
priority: p1
created: 2026-09-04T22:49+08:00
parent:
area:
resolution: shipped
---

## Context

PLAN.md rejects the analytics dashboard and asks for an inbox. The mockup
there is the specification: a score, the source and age, the post text, a list
of reasons it matched, three sub-scores, and three actions.

The reasons are the part that makes this different from a keyword alert. A
person reading a match decides in about two seconds whether to open it, and
they decide on the reasons, not the number. If the reasons are vague the
product is a noisier version of a saved search.

What this screen must not become: charts, sentiment, share of voice, word
clouds. PLAN.md lists these as out of scope and the list is worth honouring
early, because a dashboard is what everyone reaches for when a screen looks
empty.

Ordering is by score and recency together. A 96 from three days ago is worth
less than an 88 from ten minutes ago, because the conversation is still open.
How much less is a judgement to settle during the work and record here.

Settled at **twelve points a day**, subtracted from the score. It is the
smallest round number that satisfies the example above: three days costs 36
points, so the 96 ranks 60 and the 88 ranks 88. A day-old 90 ranks with a
fresh 78, and after a week almost nothing outranks a fresh match, which is the
intent — a week-old thread is closed. Linear and not exponential, because a
person has to be able to predict it: "it loses half a point an hour" is a
sentence somebody can hold, and a half-life is not.

## Acceptance

- [x] A list shows matches with score, source, subreddit or handle, age and an
      excerpt
- [x] Each match shows the reasons it matched, as specific claims about the
      post
- [x] Each match shows problem fit, ICP fit and intent
- [x] Opening the original conversation is one click, in a new tab
- [x] The list is filtered by monitor and by minimum score
- [x] Ordering accounts for both score and age, and the rule is written down
- [x] The list loads and stays usable with several thousand matches
- [x] No chart, sentiment score, word cloud or share-of-voice appears anywhere
      on the screen

## Notes

- Depends on [US-009](US-009-the-model-scores-a-post-against-a-monitor.md).
- PLAN.md, *Product UX*, holds the mockup and the exclusion list.
- The *Draft reply* action in the mockup is deliberately not in this ticket.
  It is a second model call with its own cost and its own failure modes, and
  the inbox is useful without it.

### One action, not three

The mockup shows three buttons. Only *Open conversation* is here. *Draft
reply* is excluded above. *Not relevant* is US-012, which owns the `feedback`
table and the append-only verdict history, and a button that wrote nothing
would be worse than no button.

### The screen has never shown a real match

Everything below was driven against seeded rows and stubbed responses. No
match in this product has been produced by a live classification and then
read on this screen, because the live run of 2026-09-05 stored posts and
never scored them with a real model. Until that happens, the claim proven
here is that the list renders what the database holds — not that what the
database holds reads well.

### jsdom does not follow a fragment link

The header links are asserted to exist and the shell is asserted to follow the
hash, but the click between them is not driven: jsdom leaves the location
untouched and fires nothing for a link to `#/`. The gap is whether a real
browser turns that link into that hash.

## Log

- 2026-09-04T22:49+08:00 — Written from PLAN.md.
- 2026-09-05T07:31+08:00 — Built the read side, the route and the screen.

  `packages/core/src/matches/matches.ts` holds the ordering rule, the hidden
  filter and the page boundary, for the reason `monitors.ts` gives: the
  deletion job of US-015 writes `matches.hidden`, and the inbox is the caller
  that has to honour it. A rule written in the Fastify handler would be a rule
  one caller obeys.

  Two decisions worth keeping. The clock is a parameter: the first page
  returns the `asOf` it ranked against and every later page sends it back, so
  a match cannot slip between two pages while somebody reads. And paging is
  keyset on the rank and the id together — an offset over a rank that moves
  with the clock skips rows, and the failure looks like a match that was never
  delivered, which nobody can see.

  The intent label comes from `monitors/signals.ts`, the file both prompts
  already read. The card and the checkbox now say the same words, and a test
  fails if a new intent type reaches the screen as a bare id.

  Migration 0006 adds `matches_inbox_idx`, partial on `hidden = false`.

- 2026-09-05T07:31+08:00 — Measured, on 5,000 matches for one monitor, on the development
  Postgres:

  | What | Time |
  |---|---:|
  | First page of 50 | 12.7 ms |
  | Each later page | 9.1 ms |
  | All 100 pages | 902 ms |

  `EXPLAIN ANALYZE` on the filtered query uses `matches_inbox_idx` for a
  bitmap index scan and then a top-N heapsort, at 2.8 ms of execution. The
  guard against a slow inbox is the keyset paging and that index, not a timing
  assertion: a budget of two seconds would pass today and would keep passing
  after somebody made the query fetch every row.

- 2026-09-05T07:31+08:00 — Gave the empty inbox three answers instead of one. It had a
  single "Create a monitor" button under every empty list, which is the wrong
  offer twice out of three times. With monitors but no matches, the person is
  waiting for the worker and nothing on the screen updates itself, so the
  button asks the server again. With a filter set, the list may be empty
  because of the filter, so the button clears it. Only a deployment with no
  monitor at all is offered the form.

- 2026-09-05T08:09+08:00 — Renamed the reasons section from "Why it matched" to "What the
  model saw", and replaced the green tick with a neutral bullet. The first
  live scores showed why. On a post at 31 the model wrote "the post does not
  ask for a testing tool, paid service, or automation solution" — an accurate
  and useful claim, printed under a heading that said it was a reason the post
  matched, with a tick beside it.

  The prompt is not wrong. It asks for claims about the post, not for support
  for the score, and that is the right thing to ask for: a model told to
  justify its own number will find a way. The screen was wrong. A heading that
  only reads correctly on a strong match hides exactly the matches a person
  most needs to dismiss quickly. PLAN.md's mockup is updated with the same
  reasoning.

- 2026-09-05T07:31+08:00 — Broke five things on purpose and watched the suite. Dropping
  the age clamp, the hidden filter, the id half of the cursor and the score
  filter each turned a case red, and so did doubling the decay constant —
  after the ordering expectations were rewritten as literal numbers. Written
  from the constant, they had passed at any value, which is exactly the guard
  docs/testing.md warns about.

- 2026-09-05T08:09+08:00 — Bundled Ubuntu instead of trusting the fonts installed on the
  host. The inbox uses Ubuntu's real 400, 500 and 700 faces. Its prose is 16px
  with a 72-character line and more leading. Labels and metadata share one
  scale and two accessible colours. Removed the platform-dependent score
  glyphs because the score colour and label already carry their meaning.

  Rendered the four development matches in Chrome at 1440px and 390px. The
  build, typecheck, lint and fourteen inbox cases pass.
