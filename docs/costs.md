# What SignalScout says a monitor cost

> **Running SignalScout rather than changing it?** The guide for what SignalScout costs to run is on
> [docs.signalscout.run/self-hosting/costs](https://docs.signalscout.run/self-hosting/costs), written for
> a self-hoster; its source is [`site/self-hosting/costs.md`](../site/self-hosting/costs.md). This page holds
> the rules and reasons a contributor needs.

SignalScout runs on your API keys, so it must answer two questions: what has
this monitor spent, and how do I stop it spending more. This page holds the
rules behind both answers and what the answer is not. The measurements are in
the Logs of US-013, US-014 and US-158, and of the ticket each rule names.

---

## Every figure SignalScout shows is an estimate

**The provider's invoice is authoritative. Ours is not.** We do not read your
bill. We count the units each call reported and multiply by the price the
connector declares — each connector's `pricePerUnitMicros`, and the
`postsPerUnit` it measured. That arithmetic is wrong in these ways, and
probably one more we have not met:

- **A failed call may still be billed.** A call that never came back reported
  no units, so it is not in our total.
- **The months differ.** Ours starts on the first at midnight UTC. Your
  provider's starts wherever your account says.
- **A price changes without asking us.** Prices are constants in this
  repository.
- **A free allowance is not modelled.** Every unit is priced at the paid rate.
- **A vague query is not free silence.** X refunds a search that matches
  nothing; LinkedIn, YouTube and Instagram return unrelated results at full
  price, and then the model is paid to read them.
- **The model's half of a poll is not in the cost test**, and the pre-filter
  decides how big it is, which is the number nobody can predict.

**A comment is not priced like a post.** A connector declares
`replyPricePerUnitMicros` separately, because a guard fed the post price lets
a monitor spend five times its cap. An Instagram comment is the dearest item
this product fetches, about $0.0027, and Instagram is the one platform where
the provider costs more than the model. Set a cap before ticking that box.

**A price we do not have is null, never a guess.** `estimated_cost_micros`
is null on a call whose price is not configured, and null means *we cannot
say*; it counts as nothing. A local model through Ollama is genuinely free, an
unpriced hosted model is unknown, and a number we invented would be
indistinguishable from a measured one. This is why:

- **Embeddings have no price until `AI_EMBEDDING_PRICE_MICROS` is set.** The
  amount is about a hundredth of a classification.
- **DeepSeek has no row in `modelPrices`.** Its four rates per model (peak,
  off-peak, cache hit, cache miss) differ a hundredfold and the API does not
  say which band a call landed in. Set `AI_INPUT_PRICE_MICROS` and
  `AI_OUTPUT_PRICE_MICROS`, or the per-job price on the Models screen, and set
  the dearest band.
- **Triage prices fall back to the classifier's only while no separate
  triage model is named.** Once one is, `AI_TRIAGE_INPUT_PRICE_MICROS` and
  `AI_TRIAGE_OUTPUT_PRICE_MICROS` do not fall back, because a cheaper model
  billed at the classifier's rate would report a saving that never happened.
- **The draft and the search plan follow the same rule**, on `AI_DRAFT_*`
  and `AI_PLAN_*`. The plan is the one job worth a dearer model than the
  classifier's: it is written once per monitor, decides every post the
  monitor will collect, and a model twenty times the price costs cents
  (US-269). Its calls are recorded under `query_generation`.

**Every amount on a screen is labelled *estimated* and printed to four
decimal places, never rounded to cents.** Ten Reddit records cost $0.015, and
a page that rounded that to two cents could not be reconciled against
anything. Use our figure to notice a monitor running away. Use the invoice to
know what you owe.

### Triage is a model call, not a free stage

The pre-filter's third stage asks a cheap model one question about every item
the first two kept, so it spends on the items it keeps as well as the ones it
drops. A one-word answer is not a short call: a reasoning model bills its
thinking as output, and a triage call costs about what the classification it
avoids costs.

**The saving is the price gap between the two models, and nothing else.** A
classifier ten times dearer than the triage model made the bill 61% smaller;
the same model on both stages made it 37% larger. The worker warns at startup
when the two match.

**A deployment with no cheaper model switches the stage off with
`AI_TRIAGE=off`.** Leaving `AI_TRIAGE_MODEL` blank does not switch it off; it
runs triage on the classifier's own model, which costs more and keeps the one
risk a cascade has: a triage drop leaves no row, no inbox entry and nothing
for a person to notice. A cascade is worth that risk only when the second
reader is much dearer.

**An evaluation model is the cheapest triage available and it is not
promoted.** `AI_TRIAGE_PROVIDER=typesafe` with `AI_TRIAGE_MODEL=jev-latest`
answers a typed question, at about an eighth of the cost per item, and it
reports a confidence: a `no` below 0.6 keeps the item. It is not recommended
because its numbers were fitted to the sample they were scored against
(US-229) and the rule it triages by is not the one `triage-prompt.ts` sends
to a language model. Nothing runs on it until a deployment asks.

---

## What is recorded

Two tables, and both are written whatever the outcome. Everything is in
**micro-dollars**, millionths of a dollar, as integers: a classification costs
about $0.001, and a column in cents would record a month of it as zero.

**`api_usage`** holds one row per monitor per source per day: the units the
connector reported and their estimated cost. It is written **after every
page**, because a poll that fails on its third page was billed for the first
two. A call billed nothing is still recorded: a ledger that skipped those
could not tell "polled and cost nothing" from "never polled", and only the
second is a bug.

**`model_calls`** holds one row per call to a model — classification, query
generation, triage and embeddings alike — including the ones refused. A
refusal is billed like an answer. The `purpose` column is what tells four
different prices apart; triage and classification are often the same model,
and without it the one number the triage stage exists to prove could not be
read. An embedding call covers a batch and carries the monitor and no post; a
triage call is about one item and carries it.

**Both tables carry `user_id`, written by the caller, never read off the
monitor** (US-162). A draft, a query generation, a cost test and a key test
have no monitor and are the account's money all the same. `accountSpend` sums
both ledgers for one account and one month; `draftsThisMonth` counts one
purpose. A row with no owner is on nobody's month — *we cannot say*, never a
guess.

---

## The day's ceiling on a pair

Off unless an application sets it, and this repository's own application does
not. US-287. A hosted product that pays for every account sizes its plans on a
number of new posts a query may bring to the classifier in a day, and hourly
polling has no bound of its own: the first poll of a query is its whole
backlog, and a busy query polled every hour brings thousands. So `startWorker`
takes `newPostsPerPairPerDay`, and with it set:

- A pair — one query on one platform, or one channel — may put that many
  posts to the classifier in a UTC day. A post found by two pairs counts
  against both and is read while either has room. A reply is its parent's.
- A post past it is stored and not read, and written to `filter_drops` under
  the stage `ceiling`, so the Monitors screen counts it beside the filter's
  own drops ("past the day's limit for the search that found them"). It is
  not read on a later day: the day's posts are the day's.
- A reply page counts as one of the pair's posts a day, and a pair whose day
  is spent opens no thread.

The count is `model_calls` joined to `post_discoveries`, never a counter of
its own, so it cannot disagree with the ledger. With the number unset, none of
this runs.

## The cap

A monitor may have a monthly cap and one of two behaviours. **pause**: the
monitor is paused at the cap and collects nothing until a person raises the
cap and resumes it. **notify**: each poll is refused while the cap is spent,
and polling resumes by itself when next month's spend resets. A monitor with
no cap still records everything. There is no default cap: that would be this
software deciding how much of your key it may use.

**The cap can be overshot by up to one poll.** The guard runs before a poll,
because a page is billed when fetched. It cannot know what the poll will cost:
the connector decides how many records a query collects. What bounds the
overshoot is `maxPagesPerPoll` in `worker/collect.ts`, not the cap. The cost
test is the answer to the size of the thing; the guard is the answer to the
running of it.

**A refused poll leaves bought work unread.** A collection already paid for
and not yet read is not read while the cap is spent, because every post in it
would go to the classifier. The `source_continuations` row stays, and raising
the cap reads the snapshot rather than paying for the query again.

**A plan is exhausted at `spend >= cap`**, not past it. A plan that lands
exactly on its cap stops collecting before the month ends.

---

## What a plan would cost, before it runs

On a metered source the money goes at fetch time, before any filter and before
the model reads a word. No later stage can save a person from a query that is
too broad; only a narrower query can. So the monitor form has a **Test this
plan** button. It runs each query once, against ten posts, and reports how
often that query finds a post, what a month would cost at this monitor's
schedule, and what the test itself just cost.

**The test spends money**, about a cent and a half a query at Reddit's rate.
It runs when the button is pressed, never on a keystroke, and the answer says
what the answer cost. **Its cost is recorded with no monitor against it**: a
null `monitor_id` in `api_usage`, on the bill and on no monitor's cap. A cap
guards the worker, which spends at 02:00 with nobody watching.

### The arithmetic

    records a poll       what the source charged for one sample of this query
    records a month      = records a poll x polls a month
    estimated cost       = records a month x the source's price

**Count the records the source charged for, never the posts we kept.** The
first live run billed ten records for a query and returned no posts, and an
earlier arithmetic reported that query as free; it would have cost that on
every poll for ever, with nothing on the screen arguing for deleting it.

**The projection uses the schedule the person chose, including the days.** A
weekday monitor is quoted five sevenths of a daily one. An estimate records
the schedule it priced; change the schedule afterwards and the old estimate is
stale rather than silently re-priced. A quote is a record of what you were
told.

**Some figures are a range.** When a sample of ten is billed all ten, the
source had more to give and a real poll asks for fifty, so the screen shows
both ends. A single figure invented from that would be a number nothing
measured. **The cap is checked against the high end**: a warning about money
is worth giving early, and the range is what lets a person disagree with it.

**What the estimate is wrong about.** A week is not a month: the sample looks
back seven days, and a query about last week's launch has no history. A poll
is not a sample: a poll asks for five times as many records. The model's half
is not in it.

### The flag

A plan projected past the monitor's cap is flagged **line by line** before the
monitor can start, so a person sees which query is the expensive one. "This
query costs $54 of your $10" is an instruction; "your plan is too broad" is
not. Flagged, the form saves the monitor **without starting it**. Keeping a
plan and starting it are two decisions, and the second belongs to a person who
has now seen the number.

---

## The pre-filter is a cost control, and it is also a risk

Three stages sit between collection and the model: a free keyword and
subreddit match, a similarity comparison that costs one embedding per post,
and triage, which asks a cheap model one question per surviving item. The
third exists because the first two measure *subject*, and no similarity
threshold separates a person asking from the experts replying under them.

**A threshold set too high drops good leads where nobody can see it.** An
empty inbox looks the same whether the week was quiet or the filter ate it.
So, by design:

- The threshold starts low, 0.15 cosine similarity, chosen from five measured
  posts, not a distribution.
- Every drop is written to `filter_drops` with the similarity that caused it.
- The Monitors screen shows how many posts each stage kept from the model, and
  the whole filter can be turned off per monitor. Turning it off turns triage
  off too. `AI_TRIAGE=off` turns triage off for the whole deployment while the
  rest runs.
- Triage has no threshold, so its drops are the ones to read rather than
  count. Only an explicit refusal drops an item; a timeout, a rate limit or an
  unreachable provider passes it on, and every refusal is a `filter_drops`
  row.
- An embedding that fails never drops a post. The post goes to the model,
  which costs more and hides nothing.

---

## Deletion checks

Re-checks of matched posts go through the selected provider and are metered
too. Each unit is written to `api_usage` under the monitor that started the
check; a shared post is checked once for all its matches. The cap is checked
before each call, new checks yield to due polls and to collections waiting on
a snapshot, and one final call can overshoot the cap. Pausing collection does
not stop checks. See [deletions.md](deletions.md).

## Where to look

- The cap and the spend are on the **Monitors** screen, and a refused poll
  says why there in the sentence the worker logged.
- The rule is `packages/pipeline/src/budget/budget.ts`, a correctness-critical
  surface: its assertions were written before it was.
- The pre-filter is `packages/pipeline/src/worker/filter.ts`; its keyword rule
  is `packages/engine/src/filter/keywords.ts`.
- The cost test's arithmetic is `packages/engine/src/estimate/estimate.ts`,
  also written test-first; the samples are collected by
  `packages/pipeline/src/worker/estimate.ts` on the `estimate` queue.
