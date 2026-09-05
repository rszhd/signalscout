# What IntentWatch says a monitor cost

IntentWatch runs on your API keys. So it has to be able to answer two
questions: what has this monitor spent, and how do I stop it spending more.
This page says how it answers them, and — more important — what its answer is
not.

---

## Every figure IntentWatch shows is an estimate

**The provider's invoice is authoritative. Ours is not.**

We do not read your bill. We count what each call reported and multiply it by
the price the connector declares:

| | Billable unit | Price per unit |
|---|---|---|
| Reddit, through Bright Data | one record | $0.0015 |
| X | one post read | $0.005 |
| A model call | one call | the provider's own token price |

That arithmetic is wrong in at least five ways we already know about, and
probably in a sixth we do not:

**The free allowance is not modelled.** Bright Data's first 5,000 records each
month cost nothing. IntentWatch prices every record at the paid rate, so a
monitor inside the free tier reads as more expensive than it was.

**A failed call may still be billed.** A call that never came back reported no
units, so it is not in our total. It may well be on the invoice.

**The months may not be the same month.** Our month starts on the first at
midnight UTC. Your provider's billing month starts wherever your account says.

**A price changes without asking us.** The prices above are constants in this
repository. A provider that raises one does not tell the code.

**An embedding has no price until you set one.** The pre-filter embeds the
monitor once and each post it keeps, and we carry no price table for embedding
models. Until `AI_EMBEDDING_PRICE_MICROS` is set, those calls are recorded with
no cost — which reads as *we cannot say*, not as *free*. The amount is small:
an embedding costs about one hundredth of a classification, which is why the
stage saves money at all.

This is why every amount on a screen is labelled *estimated*, and why the
figure is deliberately printed to four decimal places rather than rounded to
cents: ten Reddit records cost $0.015, and a page that rounded that to two
cents could not be reconciled against anything.

Use our figure to notice a monitor running away. Use the invoice to know what
you owe.

**One day has been compared, once.** On 2026-09-05 Bright Data's dashboard
reported 95 records and $0.14. `api_usage` held 98 records and $0.147 for the
same day: three records more, 3.2%, and high rather than low. The cause is not
identified. The likeliest candidate is that a collection is triggered with
`include_errors=true` and we count every record the snapshot reports, while the
provider does not bill a record that failed. Two things this does not prove: a
dashboard is not an invoice, and one day is not a reconciliation. Their $0.14
is 95 × $0.0015 = $0.1425, rounded to cents — which is the rounding this
document refuses to do.

---

## What is recorded

Two tables, and both are written whatever the outcome.

`api_usage` holds one row per monitor per source per day: the billable units
the connector reported, and their estimated cost. It is written after every
page, not once per poll, because a poll that fails on its third page was billed
for the first two.

A call that was billed nothing is still recorded. Bright Data's trigger call
bills no records, and a poll that finds only posts older than the last one
bills records and returns nothing. A ledger that skipped those could not tell
"this monitor polled and cost nothing" from "this monitor never polled" — and
the second is a bug while the first is a Tuesday.

`model_calls` holds one row per call to a model — classification, query
generation and the pre-filter's embeddings alike — including the ones that were
refused. A refusal is billed like an answer.

The `purpose` column is what makes the three tellable apart, and they are three
different prices. One embedding call covers a batch of posts, so it carries the
monitor and no single post: it is on the monitor's bill, which is where the cap
reads it.

`estimated_cost_micros` is null on a model call whose price is not configured.
Null means *we cannot say*, and it is counted as nothing rather than guessed.
A local model through Ollama is genuinely free; an unpriced hosted model is
unknown; a number we invented would be indistinguishable from a measured one.

Everything is stored in **micro-dollars** — millionths of one US dollar, as
integers. One classification costs about $0.001, which is a tenth of a cent, so
a column in cents would record a month of classification as zero.

---

## The cap

A monitor may be given a monthly cap and one of two behaviours.

**pause** — the monitor is paused when the cap is reached. It collects nothing
until a person raises the cap and resumes it. Its posts, matches and verdicts
are untouched.

**notify** — the monitor is left running and each poll is refused while the cap
is spent. It starts collecting again by itself when next month's spend resets,
with nobody pressing anything.

A monitor with no cap still records everything it spends. A default cap would
be this software deciding how much of your key it may use.

### The cap can be overshot, by up to one poll

The guard runs before a poll, because a page is billed when it is fetched and a
check afterwards has already spent the money. But it cannot know what the poll
it is about to allow will cost: the connector decides how many records a query
collects.

So a monitor at $9.99 of a $10.00 cap will start one more poll, and that poll
may cost more than a cent. What bounds the overshoot is `maxPagesPerPoll` in
`worker/collect.ts` — five pages, one job — not the cap.

[The cost test](#what-a-plan-would-cost-before-it-runs) is the answer to this,
and it is a different kind of answer: it does not stop the overshoot, it tells
a person the size of the thing before they start it. A monitor whose plan was
measured at $164 a month against a $10 cap was never going to be saved by a
guard that runs one poll at a time.

### What a refused poll does with money already spent

A collection Bright Data has already been paid for and not yet read is not read
while the cap is spent. Reading it would cost nothing more at the source, but
every post it holds would go to the classifier, and that is money past the cap.

The row in `source_continuations` stays. Raising the cap reads the snapshot
rather than paying for the query again — if the provider still has it.

---

## What a plan would cost, before it runs

`api_usage` answers "what has this monitor spent". It cannot answer "what will
this plan spend", and on a metered source that is the more expensive question:
the money goes at fetch time, before any filter and before the model reads a
word. No later stage can save a user from a query that is too broad. Only a
narrower query can.

So the monitor form has a **Test this plan** button. It runs each query once,
against ten posts, and reports three things: how often that query finds a post,
what a month of it would cost at this monitor's poll interval, and what the
test itself just cost.

**The test spends money.** That is the honest tension in it: the only way to
find out what a query collects is to collect a little of it. Ten records a
query is about a cent and a half at Reddit's rate, so testing a plan of eight
queries costs about twelve cents. It runs when the button is pressed, never on
a keystroke, and the answer says what the answer cost.

**The test's own cost is recorded with no monitor against it.** The plan is
usually still a plan — the whole point is to decide before committing — so the
row in `api_usage` has a null `monitor_id`. It is on the bill and on no
monitor's cap. `model_calls` already does this for the queries the model
writes from the same form. A cap guards the worker, which spends at 02:00 with
nobody watching; the cost test spends only when a person presses a button and
is shown the price.

### How the monthly figure is worked out

    records a poll       what the source charged for one sample of this query
    records a month      = records a poll x polls a month
    estimated cost       = records a month x the source's price

**The cost is counted from the records the source charged for, never from the
posts we kept.** Those are different numbers, and the difference is the whole
reason a connector reports `unitsConsumed` instead of letting the caller count
rows.

The first live run, on 2026-09-05, is why this page says so. A sample of "flaky
end to end tests" was billed ten records and returned no posts at all: every
post it found was three weeks old, outside the window the sample asked for. An
earlier version of this arithmetic counted the posts and reported that query as
costing nothing. It had just cost a cent and a half, and it would have cost
that on every poll for ever, with nothing on the screen arguing for deleting
it.

Polling is still the multiplier, and still the biggest dial a person controls:
the same query costs $10.80 a month polled hourly and $648.00 polled every
minute.

### Why some figures are a range

A sample asks for ten records. When the source bills all ten, it had more to
give, and a real poll asks for fifty — so a month is somewhere between $10.80
and $54.00, and one sample of ten cannot say where. The screen shows both ends.

A single figure invented from that would be a number nothing measured, which is
what this page exists to refuse. The cap is checked against the high end,
because a warning about money is worth giving early and the range is what lets
a person disagree with it.

### What this estimate is wrong about

Everything in the list above, and three more of its own.

**A week is not a month.** The sample looks back seven days and multiplies. A
query about a product launched last week has no history to measure, and a quiet
Tuesday will lie about a busy Friday.

**A poll is not a sample.** The projection assumes a poll of one query costs
what one sample of it cost. A poll asks for five times as many records, so a
query with more to give costs more than the low end says — that is what the
range is for, and the range is wide.

**The model's half is not in it.** The figures here are what the *source*
charges. Classifying the posts a plan collects costs about a tenth of a cent
each, and the cost test does not add it. A plan that collects 7,200 records a
month will also send some of them to a model — how many depends on the
pre-filter, which is exactly the number nobody can predict before the monitor
runs.

### The flag

A plan projected to cost more than the monitor's cap is flagged before the
monitor can start, line by line, so a person can see which query is the
expensive one. "Your plan is too broad" is not an instruction; "this query
costs $54 of your $10" is.

Flagged, the form saves the monitor **without starting it**. Keeping a plan and
starting it are two decisions, and the second one belongs to a person who has
now seen the number. The Monitors screen starts it when they are ready.

The flag counts *at* the cap, not past it, because US-013's guard does: a
monitor is exhausted at `spend >= cap`, so a plan that lands exactly on its cap
is a plan that stops collecting before the month ends.

---

## The pre-filter is a cost control, and it is also a risk

Between collection and the model sits a filter with two stages: a free keyword
and subreddit match, then a similarity comparison that costs one embedding per
post. Both exist to keep the model bill down, and the second one pays for
itself as soon as it drops a few posts in a hundred.

The risk runs the other way. **A threshold set too high drops good leads where
nobody can see it.** An empty inbox looks the same whether the week was quiet
or the filter ate it. So three things are true by design:

- The threshold starts low — 0.15 cosine similarity. One run has measured it:
  on 2026-09-05 a real embedding model put PLAN.md's four on-topic posts at
  0.26 to 0.57 and a post about sourdough at 0.09, so 0.15 sits inside that gap
  with room on both sides. **That is five posts, not a distribution.**
- Every drop is written to `filter_drops` with the similarity that caused it,
  so the threshold can be argued with using real data.
- The Monitors screen shows how many posts each stage has kept from the model,
  and the whole filter can be turned off per monitor.

An embedding that fails never drops a post. The post goes to the model instead,
which costs more and hides nothing.

---

## Where to look

- The cap and the spend are on the **Monitors** screen, next to the monitor
  they belong to. A refused poll says why there, in the same sentence the
  worker logged.
- The rule itself is `packages/core/src/budget/budget.ts`. It is one of the
  five correctness-critical surfaces in [testing.md](testing.md), so its
  assertions were written before it was.
- The pre-filter is `packages/core/src/worker/filter.ts`, its keyword rule is
  `packages/core/src/filter/keywords.ts`, and what it dropped is in
  `filter_drops`.
- The cost test's arithmetic is `packages/core/src/estimate/estimate.ts`, and
  its assertions were written first for the same reason: it puts a number in
  front of a person who is about to spend money. The samples are collected by
  `packages/core/src/worker/estimate.ts`, on the `estimate` queue.
