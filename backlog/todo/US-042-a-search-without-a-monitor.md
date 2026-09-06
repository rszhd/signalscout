---
id: US-042
title: A search without a monitor
type: feature
priority: p2
created: 2026-09-06T12:35+08:00
parent:
area:
resolution:
---

## Context

**Everything this product does is keyed to a monitor, and a person may just
want to look.** To ask "is anybody talking about this" today you must create a
monitor: answer four questions, generate a query plan, accept a cost estimate
and start something that then polls for ever. That is a lot of ceremony for a
question, and the answer to the question is what tells you whether the monitor
is worth having.

**Most of the machinery already exists, in the last place anybody would look
for it.** US-014's cost test — `worker/estimate.ts` — already runs a real query
against a real provider, fetches real posts, shows a handful to a person, and
records the spend to `api_usage` **with a null monitor id**, because there is no
monitor yet. It is an ad hoc search that throws its results away and reports the
price instead.

So this is not a new pipeline. It is that step, keeping what it found.

**The hard part is not fetching. It is what "relevant" means with no monitor.**
A monitor is not a saved search; it is the scoring profile. `ai/prompt.ts`
builds the classifier's system prompt from the monitor's four answers — the
product, the ideal customer, the problem, the signals — and without them there
is nothing to score against. Three honest answers, and the ticket should pick
one rather than blur them:

* **Borrow a monitor's profile.** Search with new words, score against an
  existing monitor. Cheap, and it only helps somebody who already has one.
* **Ask for the four answers.** Then it is a monitor in everything but
  persistence, and the ceremony is back.
* **Do not score at all.** Return what the provider returned, ranked by nobody.
  Honest, cheap, and it throws away the thing that makes this product not a
  search box.

**Two holes open the moment a search has no monitor, and both are about
money.**

`api_usage.monitor_id` is nullable and the cost test already writes null rows —
docs/costs.md tells the user those land on the bill and on no monitor's cap.
That is correct for one estimate a person waits through. It is wrong for a
button somebody can press twenty times: **an unmonitored search has no cap at
all**, and BUG-004 was written this week because a spend path with no guard is
how money leaves quietly.

And a search that scores its results buys a model call per post. The cost test
avoids that by not scoring. Whichever answer the scoring question gets, the
budget answer has to come with it.

**What it should not become.** Not a second inbox, not a saved-search list, not
a monitor with `paused = true` wearing a different name. If the answer turns out
to be "a monitor you have not started yet", then US-014's *save the plan without
starting it* already exists and this ticket is a screen, not a feature.

## Acceptance

- [ ] A person can run one search from a query, without creating a monitor
      first
- [ ] The results are shown to them, and the screen says plainly whether they
      are kept or discarded when the page is closed
- [ ] The scoring question is answered in the Log, in one sentence, with the
      reason — borrow a profile, ask for one, or return unscored results
- [ ] The spend is capped. An unmonitored search is refused when the deployment
      or the person is over a limit, and the limit is somewhere a person can see
- [ ] Every call is recorded in `api_usage` and `model_calls`, so "what was my
      key spent on" stays answerable for spend that belongs to no monitor
- [ ] Running a search twice in a row does not pay twice for the same page,
      or the Log says why it does
- [ ] If a person likes what they see, turning the search into a monitor keeps
      the query rather than making them retype it
- [ ] The Log records what one search costs, measured

## Notes

- `worker/estimate.ts` is the file to read first. It is a working ad hoc search
  that discards its results, and the shortest version of this feature is that
  step plus persistence.
- `docs/costs.md` already explains a null-monitor usage row to the user. Adding
  a second source of them is fine; adding one with no cap is not.
- US-014 measured what a sample costs: three live cost tests spent $0.042, and
  one query billed ten records for $0.015. A search is the same shape.
- The estimate takes 1 minute 41 seconds to 8 minutes 8 seconds, measured across
  three runs, because a provider may be asynchronous. A search that made a
  person wait eight minutes at a screen would be worse than the ceremony it
  replaces — so the answer may be that this only serves synchronous providers,
  and that is worth saying rather than discovering.
- **Do not price anything from a post count.** US-014 cost $0.042 to learn that:
  cost comes from `unitsConsumed` and volume comes from posts.

## Log

- 2026-09-06T12:35+08:00 — Written after the owner asked for ad hoc search. The
  finding that shapes it is that the fetching already exists inside the cost
  test, so the real questions are what "relevant" means without a monitor's four
  answers, and what caps a spend path that belongs to nobody.
