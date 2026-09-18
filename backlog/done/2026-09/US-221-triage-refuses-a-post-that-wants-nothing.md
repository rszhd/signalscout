---
id: US-221
title: Triage refuses a post that wants nothing
type: feature
priority: p1
created: 2026-09-18T19:06+08:00
parent: US-030
area: engine
resolution: shipped
---

## Context

US-220 turned triage on because a score floor was the wrong tool: a floor hides
a low score, and triage stops it being paid for. The stage now runs, and the
question is whether it refuses enough.

What it asks today is "could the author plausibly be a person this product
should reach?". That is a question about **who** the author is. The classifier
behind it scores five things, and three of them are about **what the author
wants**: does the author describe this problem in their own words, are they
looking for a solution now, is it happening now. So a post can pass triage as a
plausible person and still score 20, because the person wants nothing.

The captured verdicts show where that slack sits. Fifty items, `gpt-5.6-luna`,
2026-09-06:

| Group | no | maybe | yes |
|---|---|---|---|
| answering (experts) | 20 | 5 | 1 |
| asking | 1 | 2 | 1 |
| neither | 6 | 6 | 4 |
| worked-example posts | 0 | 1 | 3 |

`maybe` passes, so 14 of 50 items go on as "I cannot tell". Five of them are
people **answering** — experts naming tools under somebody else's question,
which is the group the header already calls the largest and the cheapest to
refuse. Those are the paid classifications this ticket is after.

**Dropping `maybe` is not the way, and the same table says so.** Two of the
three people asking who survive are `maybe`, and so is one of the four worked
examples. A rule that drops `maybe` deletes two real leads out of four to save
five expert comments. The fail-open asymmetry is unchanged: a wrong `no` leaves
no row, no inbox entry and nothing anybody can notice.

So the change is in what `maybe` is **for**. Today it absorbs every kind of
doubt, including an expert who plainly wants nothing. Split it: doubt about
whether a person wants something stays `maybe`; the plain absence of wanting
anything becomes `no`.

## Acceptance

- [x] The prompt names what the second reader scores, so triage screens for the
      same thing instead of a near neighbour of it.
- [x] `no` covers the author who wants nothing — answering, selling,
      announcing, teaching, joking, reporting, or describing somebody else's
      problem — not only the author who could not be a customer.
- [x] `maybe` is stated as doubt about a want, not as doubt about anything.
- [x] The fail-open rule is untouched: only an explicit `no` drops, and every
      failure keeps the item.
- [x] `capture:triage` is re-run on the same 50 items, the fixture is replaced
      and the numbers are written here.
- [x] Every worked example PLAN.md scores as a lead still survives, and the
      people asking do not fall below three of four.
- [x] `pnpm test`, lint and typecheck pass.

## Notes

- The capture spends money: 50 short calls, about 13 cents on `gpt-5.6-luna`.
  It is the only instrument that can answer whether this worked, and the owner
  approves the run.
- `triage-examples.test.ts` asserts bands, not counts, because the same 50
  items answered differently on two runs on one day. New bands go in with the
  new fixture.
- Nothing about the code path changes. `filter.ts` already drops on `no` alone
  and `triage.ts` already keeps everything that is not an answer.

## Log

- 2026-09-18T19:06+08:00 — Asked for by the owner: "can we make triage more
  strict, so better chance of having it eliminate posts that might be scored
  low during classification."
- 2026-09-18T19:20+08:00 — First capture, `gpt-5.6-luna`, 50 items, $0.0137. It
  worked and it broke the safety rule at the same time: comments kept fell 19 →
  15 and people answering 6 → 5, and it **refused `mild-problem-signal`** —
  "Our Playwright tests break whenever the UI changes", which PLAN.md scores 50
  and which is a lead. A complaint asks for nothing, and the prompt had just
  said that wanting nothing is a `no`.
- 2026-09-18T19:26+08:00 — The prompt now names the case: a complaint counts as
  wanting something and is never refused; the second reader weighs how much.
  Second capture, same items, $0.0137.

  | | before | after |
  |---|---|---|
  | comments kept, of 46 | 19 | **13** |
  | people answering kept, of 26 | 6 | **3** |
  | people asking kept, of 4 | 3 | 3 |
  | worked examples that are leads | 3 of 3 | 3 of 3 |
  | `low-intent`, which is not a lead | maybe (paid) | **no** |
  | output tokens an item | 123 | 80 |
  | micro-dollars an item | 267 | 273 |

  Six fewer classifications for the same money spent asking. On the
  terra–luna pair those 46 comments go from 48% cheaper with triage to 61%;
  on one model for both stages, from 48% dearer to 37%. Neither changed sign.
- 2026-09-18T19:30+08:00 — The fixture is replaced and the bands are tightened
  around the new numbers, so a prompt that stops asking what the author wants
  goes red rather than passing quietly. The stale 48% and 113-token figures are
  corrected where they are quoted: `docs/costs.md`, `ai/env.ts`,
  `ai/config.ts`, `ai/recommended.ts`, `worker/runtime.ts` and
  `recommended.test.ts`. `docs/history.md` keeps US-030's paragraph as written
  and records this one after it. 2095 tests, lint and typecheck pass.
