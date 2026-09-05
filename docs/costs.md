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

That arithmetic is wrong in at least four ways we already know about, and
probably in a fifth we do not:

**The free allowance is not modelled.** Bright Data's first 5,000 records each
month cost nothing. IntentWatch prices every record at the paid rate, so a
monitor inside the free tier reads as more expensive than it was.

**A failed call may still be billed.** A call that never came back reported no
units, so it is not in our total. It may well be on the invoice.

**The months may not be the same month.** Our month starts on the first at
midnight UTC. Your provider's billing month starts wherever your account says.

**A price changes without asking us.** The prices above are constants in this
repository. A provider that raises one does not tell the code.

This is why every amount on a screen is labelled *estimated*, and why the
figure is deliberately printed to four decimal places rather than rounded to
cents: ten Reddit records cost $0.015, and a page that rounded that to two
cents could not be reconciled against anything.

Use our figure to notice a monitor running away. Use the invoice to know what
you owe.

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

`model_calls` holds one row per call to a model, classification and query
generation alike, including the ones that were refused. A refusal is billed
like an answer.

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

Telling a person what a query will cost *before* it runs is
[US-014](../backlog/todo/US-014-a-querys-cost-is-known-before-it-runs.md), and
that is the ticket that closes this gap rather than bounding it.

### What a refused poll does with money already spent

A collection Bright Data has already been paid for and not yet read is not read
while the cap is spent. Reading it would cost nothing more at the source, but
every post it holds would go to the classifier, and that is money past the cap.

The row in `source_continuations` stays. Raising the cap reads the snapshot
rather than paying for the query again — if the provider still has it.

---

## Where to look

- The cap and the spend are on the **Monitors** screen, next to the monitor
  they belong to. A refused poll says why there, in the same sentence the
  worker logged.
- The rule itself is `packages/core/src/budget/budget.ts`. It is one of the
  five correctness-critical surfaces in [testing.md](testing.md), so its
  assertions were written before it was.
