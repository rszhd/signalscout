# Testing philosophy

Why the tests look the way they do, what we deliberately do not test, and the
one thing that changes when the code is written by an AI assistant rather than
a second person.

**These rules were paid for in another repository, not this one.** They are
adopted conclusions, not scars we earned. That has a cost worth naming: a rule
whose incident you did not live through is easy to drop under pressure. Where a
rule below cost somebody something, the paragraph says what. Read those parts
as evidence, not as decoration.

---

## What we practice

**Spec-driven, test-alongside.** A `backlog/US-xxx` ticket is the contract, and
its reasoning is written before the code. The test ships in the same commit as
the feature it covers. Not test-first everywhere, and not test-later.

**The fastest fake that still catches the bug you care about.** Most assertions
belong in plain unit tests over `packages/core`, which needs no database, no
network and no clock. Reach for a heavier shape only when the lighter one
cannot hold the claim up.

The general form of that rule: **same feature, two tests, when the shortcut one
layer takes lies about the thing the other must verify.**

Say the lie out loud before writing the second test: name the failure it
catches that the first one cannot. For ordinary CRUD, one test from the route
to the database covers the routing and the persistence together. A second test
in `packages/core` earns its place when the rule has a caller the first test
never reaches — which is what US-012 found, with the monitor routes' counts
asserted nowhere while the rule under them passed.

**A screen is driven through the DOM a person uses.** `apps/web/src/testing.tsx`
mounts a screen into a real document, finds an element by its label or by the
words on its button, and sets a value through the native setter React listens
to. A test that reaches into props can pass with the control unreachable on the
screen.

Spend that harness on the interactions that carry a decision: submitting the
monitor form, giving a verdict, showing a failed request. A presentation change
— a class, a heading, a colour — does not owe the suite a case.

**Real Postgres from the first test file.** No in-memory stand-in.

This is the one place we start where another project finished. That project ran
an in-memory Postgres fake for a year and kept a list of its lies — a `bytea`
parameter corrupted through a UTF-8 round trip so AES-GCM ciphertext never
decrypted, `on conflict do nothing` reporting a row count of 1 for a conflicting
insert, `count(*) filter (where …)` silently answering with the unfiltered
count. The tax was never the lies on the list. It was the next one, which by
definition was not on the list yet.

Two of our load-bearing pieces are exactly what such a fake gets wrong:
`pgvector` distance, and `pg-boss` claiming a job. A uniquely named database per
test file, migrations applied, dropped after, costs a few hundred milliseconds.
Pay it.

**No test spends money.** No test may reach the Reddit API, the X API, or a
model provider.

This is stricter than a convention because a mistake here has an invoice. An X
read costs $0.005, and a test loop that fetches does not stop when the assertion
passes. So the metered connectors take an injected HTTP client, and the test
setup makes the real one unreachable rather than merely unused. A test that
would spend money must fail loudly, not spend it.

**Speed and hermeticity are features.** A fast suite with no network is what
lets an assistant run everything after every change and correct itself without
a person in the loop. A slow or flaky suite breaks that loop: it gets skipped,
or a green run gets trusted that should not be.

Measured on 2026-09-11: **1,922 tests in 112 files, 74.6 seconds**, against a
Postgres that was already running. Re-measure it rather than assuming it holds
— the figure was 615 tests in 78.3 seconds on 2026-09-05, and the work between
those two dates tripled the count while the wall clock barely moved. This is a
reason to keep the suite hermetic. It is not an instruction to run all of it
after every keystroke: run the files you touched while you work, and the whole
suite before you call the work done.

---

## Working with an AI pair changes one thing

With two people, the one who writes the test and the one who writes the code
usually reach "the right answer" independently, so a shared misunderstanding
has two chances to be caught. When an assistant writes **both**, that
independence is gone.

> A test authored to match code authored by the same mind can encode one
> misunderstanding twice — the test asserts exactly the wrong thing the code
> does. Worse, a failing test can be "fixed" by quietly weakening the
> assertion instead of the code.

The mitigations, in order of leverage. Each one re-introduces an independent
source of truth.

**1. Anchor the expected value to intent, not to the implementation.** An
assertion is trustworthy when a person can read the input, agree the expected
output is right, and never look at the code. A test that recomputes the
expected value the way the code computes it proves nothing. Prefer a literal a
human can check over one the test derives.

**2. See it fail, where test-first did not already buy it.** A test you have
never watched fail is not trusted. Test-first gets this free. Test-alongside
does not, so on a test written beside or after the code, break that code on
purpose and watch that one file go red.

**This is a substitute for test-first, not an addition to it.** The tickets
measured the difference. About seventy-five deliberate mutations have been applied
across eight tickets. The three surfaces written test-first — credential
encryption, the budget guard, cursor and deduplication — took twenty-three of
them, and every one was caught the first time. Every gap came from a surface
written alongside the code:

| Ticket | What the breakage found |
|---|---|
| US-007 | A scheduler test that asserted nothing, because one monitor hid the dedup key |
| US-008 | A fail-open branch nothing covered |
| US-011 | Ordering expectations written from the constant, so they passed at any value |
| US-012 | Two route call sites counted nowhere |
| US-014 | A cost flag counting past the cap where the guard counts at it, and an unreachable branch |

So flip one line on a test you wrote alongside the code, and skip it on a
surface whose assertion was written and reviewed first. Mutating a finished
feature nine ways is a sweep by hand, and the sweep is US-018's job, not a
ticket's.

**3. Test against the real thing, not the assistant's fake.** A fake written by
the same author will agree with buggy code.

**4. Selective test-first for correctness-critical surfaces.** Not the whole
codebase — CRUD and wiring stay test-alongside. On these surfaces the
assertion is written and reviewed first, and the implementation is written
against it, so it cannot be retrofitted:

| Surface | The shape of the failure |
|---|---|
| Budget guard | Money is spent past a cap, silently, while nobody is watching |
| Cursor and deduplication | The same post is fetched and billed twice |
| Credential encryption | A key reaches a log line or an API response |
| Classification schema | An invalid score is stored as if it were a verdict |
| Deletion reconciliation | Content the author removed keeps being shown |
| Session gate | A route answers a stranger, and looks completely normal doing it |
| Entitlement | An account that stopped paying keeps polling, on our bill |

Each of these files carries a `Correctness-critical` header comment naming the
failure and the tests that pin it:

    grep -rl 'Correctness-critical' packages/*/src apps/*/src

The session gate is the one on that list whose test cannot be a sample.
Every other surface has a rule you can state and then check at each call site;
this one is a claim about *all* the routes, and the route added next month is
exactly the one that will not be checked. So `apps/api/src/auth.ts` records
what it registered, and `auth.test.ts` walks that list and asserts each entry
answers 401 without a session, against a written list of three open paths. A
test that named five routes would pass for ever and say nothing about the
sixth.

**5. The house rule: a red test is fixed in the code, not in the assertion.**

An expected value changes only when the behaviour was *meant* to change, and
the commit says which and why. This forces every disagreement between code and
test up to intent, instead of letting it be settled by editing whichever side
is easier. It is the most important line in this file.

There is one other way an expected value moves. The test never matched the
ticket in the first place — the behaviour did not change, the assertion was
wrong the day it was written. Correcting it is allowed, and the commit quotes
the line of the ticket that says what was meant. Guard the shape of that
exception: "the code looks right, so the test must be wrong" is the failure
this whole section exists to prevent, and it wears the same words.

---

## A fixture for someone else's API must be captured, not written

A fixture we wrote is evidence about our parser. It is never evidence about the
wire format.

The case that proves it: a webhook test built a Stripe subscription object with
a top-level `current_period_end`. Stripe had moved that field onto the
subscription item in a later API version. The suite was green and
self-consistent for a year — the reader read where the fixture wrote — while
every real subscription in the database had a NULL period end. Only a round
trip against a real account found it.

This matters more here than it did there. Reddit and X payloads are not one
integration in this product; they are the entire input. So:

- Every source fixture is captured from a real response by a committed script,
  and the script is re-runnable.
- The captured payload is stored whole, with identifying fields scrubbed.
- A ticket that changes a parser moves the fixture too.
- An assistant must never write a payload from memory. A plausible Reddit
  response is the exact failure this rule exists to prevent.

---

## Testing the model

The classifier is the product. Two different questions, and they need different
instruments.

**Does the code handle the model correctly?** Recorded model responses, replayed
through the real classifier. Deterministic, free, runs in CI. This covers schema
validation, a refusal, a timeout, an out-of-range score, and a malformed
response.

**Is the scoring any good?** No test in CI can answer this. PLAN.md already
holds four worked examples with the intent scores they should receive — from
"Playwright is awesome" at 3 to a four-person SaaS asking what other teams use
at 96. That is a labelled evaluation set on day one. Grow it from real matches
and from the feedback in US-012.

It is run by hand against a live provider when the prompt or the model changes,
not in CI, because it costs money and it is not deterministic. Its results go in
the ticket that changed the prompt.

Both halves are one command:

    pnpm --filter @signalscout/core capture:classifier

It scores the four examples against a live model, records the answers as the
fixtures `ai/examples.test.ts` replays, and prints the scores. The bands that
test asserts were written before the first run, and the house rule applies to
them like any other expected value: a band moves only when the behaviour was
meant to change.

---

## Rules that catch silent failures

Every rule here exists because something was green while being broken.

**A broad `catch` obliges an assertion on the happy path of the thing it wraps,
driven the way production drives it.**

The case: a memory generator ended `except Exception: return None` under an
honest promise — the feature is an optimisation, so a provider timeout must cost
a run nothing. It reached the model through `asyncio.run` from inside an already
running loop, raised on every single call, returned `None` every time, and
nothing went red. Twenty-four assertions covered the parts. None covered the one
function the caller actually calls, so the only untested line was the one
holding the `catch`.

Our version of that trap is the classifier. A model error is meant to leave a
post unclassified and retryable. If that same catch swallows a programming
error, nothing scores anything, and an empty inbox reads as a quiet day rather
than a broken product.

Testing the parts is not a substitute; the swallow lives in the seam between
them. Where the failure depends on calling context, the test must establish that
context, or it proves only that the code works somewhere production never calls
it from.

**A deliberately swallowed error needs a test that fails when the swallowed
thing does.** Otherwise the catch turns a defect into a shrug. We have two by
design: an embedding failure sends the post to the model rather than dropping it
(US-008), and a source outage is not a deletion (US-015). Both are correct. Both
need a test that goes red when the swallowed thing breaks.

The first one now has that test, in `worker/filter.test.ts`, and writing it
found the gap this rule is about. The pre-filter fails open twice — once when
the monitor's own description cannot be embedded, once when the batch of posts
cannot — and one case covered only the first branch. A mutation that dropped
every post at the second branch left the suite green. Two cases, one per
branch, is what it took. Count the branches of a swallow, not the swallows.

**A rule is only as tested as its least-tested caller.** Four tickets in a row
elsewhere shipped a correct rule that one caller never reached, with the
assertion on the rule itself green every time. The symptom is always the same
and always invisible: the feature works when a person clicks it and does nothing
at 02:00.

The budget guard already has three callers — the poll, the deletion re-check,
and the query cost test. So after "is this rule asserted?" comes "how many places
call it, and does each have its own case?" Answer it by deleting the call from
one site at a time and checking that something turns red. Two calls written
apart are two features.

**A guard whose pass and fail share an answer is guarding nothing.** An
assertion written before the code that passes on the day it is written is
asserting the code, not the contract, and it will keep passing after the
behaviour it protects is gone. The inputs that separate a guard from its absence
are the ones that take a different code path, not the ones that look most
malformed.

The cheapest check in this whole practice: **an assertion-first case that
passes immediately owes an explanation.** Usually it is wrong or incomplete.
Sometimes it is a new caller of a rule that already exists, and it passes
because the rule works. Write down which, in the ticket, before you keep the
case.

---

## What a green suite cannot say

**A green suite says the code does what we modelled. It never says the model was
right.**

When a change's reason for existing rests on third-party behaviour — a rate
limit header, a provider's payload shape, an OAuth refresh — the suite covers
our half only. The claim is not proven until it has run somewhere real. Budget
that step into the ticket rather than treating green as the finish line.

The largest instance of this is the product itself. No test says the matches are
worth reading. PLAN.md sets the real measure: are people receiving matches they
genuinely find valuable? The feedback counts in US-012 answer that. The suite
cannot.

---

## A measured constant needs a committed instrument

A test can pin what the code does with a number. Nothing in a suite can say the
number is right.

Three of ours are exactly this shape:

- the pre-filter similarity threshold (US-008) — the instrument is
  `packages/core/src/ai/fixtures/capture-embeddings.ts`, and the numbers it
  produced on 2026-09-05 are in the ticket and replayed by
  `ai/similarity.test.ts`. Five posts is a gap, not a distribution, so the
  second instrument is the `filter_drops` table: it records the similarity of
  every post the threshold refused, which is what moves the number next
- the minimum score that makes a match (US-009) — the instrument is
  `packages/core/src/ai/fixtures/capture.ts`, and the numbers it produced are
  in the ticket
- the weight of age against score in the inbox ordering (US-011)

Each owes the repository the command that produced it, committed and
re-runnable, plus the numbers it produced and the date. Otherwise the next
person to touch the constant has only a comment, and a comment cannot be re-run.

Each of the three defaults must also start permissive. A threshold set too high
discards good leads before anyone sees them, and a silent false negative is
worse than a noisy inbox, because nobody can tell it happened.

---

## Two diagnostics

**A wait in milliseconds is a race, not an ordering.** Where a test means an
ordering, say the ordering: wait on something that has definitely happened, not
on something that has probably happened by now. Widening a timeout hides a real
defect inside the same number a busy machine produces.

**When the suite goes flaky, run the suspect file alone.** A fault that survives
being run by itself is not a scheduling fault. Elsewhere this one measurement
separated a plausible story about runner oversubscription from two real causes.
Reach for it before reaching for concurrency flags.

---

## What we do not test, and why that is a choice

- **Live third-party APIs.** Covered by captured fixtures. A test that hits
  Reddit or X is a test that can be rate limited, can fail on someone else's
  outage, and on X can be billed.
- **Live model providers in CI.** Covered by recorded responses. The quality
  question is answered by the labelled set, by hand.
- **Full user journeys, and a real browser.** A screen test mounts one screen
  into jsdom and drives it, as *What we practice* describes. Nothing walks from
  the monitor form through the worker to the inbox, and nothing runs in a
  browser engine. That path is checked by hand against a live provider, and the
  ticket that does it budgets for the run.

---

## When to stop

A suite has no natural end, so name one. **Stop when every acceptance box is
verified, when the changed behaviour has a test somebody has watched fail, and
when no concrete concern is left unanswered.**

Concrete is the word doing the work. "There could be an edge case" is not a
concern. "The deletion job calls this rule and has no case" is. Write the
concern down or stop.

A test added because the suite felt thin proves nothing and is maintained
forever. The cost of the wrong extra test is not the minute it takes to write.

---

## Deferred: mutation testing

A mutation sweep proves sensitivity — that no test passes no matter what, which
is precisely the AI-pair failure mode above. It does not prove the expected
values are the ones we want; a test can kill every mutant and still pin a
misread spec.

It was deferred until there was a suite worth sweeping. That condition is met —
1,922 tests over every surface named above — so US-018 is now waiting on
somebody rather than on the code. Two reading rules from the project that ran
one, worth having in advance: a survivor list has a timestamp and can invent
gaps that are already closed, and a file that logs heavily scores low without
being worse tested.

Whenever it happens: **before believing a sweep's number, break a line on
purpose and confirm the sweep catches it.** A number from a harness nobody has
watched fail is worth exactly as much as an assertion nobody has watched fail.

## Running the suite

`pnpm test` uses a real Postgres and creates a database per test file. If it
cannot reach one it says so; it does not fall back to a fake.

**It can go red without a broken test.** A database per file, run in parallel,
can outrun Postgres `max_connections` of 100: a file fails with "sorry, too
many clients already", sometimes surfacing as a 500 from a route whose insert
could not get a connection. The failing file moves between runs and passes
alone, so it reads as flakiness rather than as what it is. Check that before
reading a red run as a regression.

Two settings hold it off and both live in `vitest.config.ts`:
`DATABASE_POOL_SIZE` caps each pool at three, and `maxWorkers` caps the run at
four. **Pass `--maxWorkers` by hand only to go lower**; the advice to run at
three is older than the pool cap and costs about ten seconds.

**Six workers were tried and reverted, and the reason is worth keeping.**
Measured when the suite was 615 tests, they peak at 57 connections of the
hundred and finish in 39 seconds against four's 41 — but `classify.test.ts` then failed two runs in four, an `until()` wait
exceeding its twenty seconds under load rather than a broken assertion. Two
seconds is not worth a suite that cries wolf: a flaky run costs far more than
it saves the moment somebody starts ignoring it.

**One number used to dominate the wall clock, and removing it is why the suite
absorbed a tripling of its test count.** It ran 170 seconds when almost all of
that was one setting. Five pg-boss worker files were 397 of the 435 seconds of
file time, every test costing four to six seconds to do milliseconds of work,
because a pipeline test sends a job and then waits for a worker to poll for it.
`WORKER_POLLING_INTERVAL_SECONDS` is set to pg-boss's floor of 0.5 for the
suite alone, and nothing sets it in production — a poll that starts a second
later is a poll that starts a second later, and a query per queue per second
against a working database buys nothing.

If a worker file starts costing seconds a test again, that is the number to
look at first, and `--reporter=json` gives the per-file timings that show it.
