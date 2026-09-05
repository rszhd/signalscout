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

**2. See it fail.** A test you have never watched fail is not trusted. Test-first
gets this free. Test-alongside does not, so bolt it on: break the code on
purpose and confirm the test goes red.

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

Each of these files carries a `Correctness-critical` header comment naming the
failure and the tests that pin it. The list is
`grep -rl 'Correctness-critical' packages apps`.

**5. The house rule: a red test is fixed in the code, not in the assertion.**

An expected value changes only when the behaviour was *meant* to change, and
the commit says which and why. This forces every disagreement between code and
test up to intent, instead of letting it be settled by editing whichever side
is easier. It is the most important line in this file.

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

    pnpm --filter @intentwatch/core capture:classifier

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

The cheapest check in this whole practice: **if an assertion-first case passes
immediately, it is wrong or it is incomplete.**

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
- **Deep frontend interaction.** Components with logic are unit tested, and a
  render smoke test catches breaks the build cannot see. Driving events and
  full user journeys costs more harness than it returns at this size.

---

## Deferred: mutation testing

A mutation sweep proves sensitivity — that no test passes no matter what, which
is precisely the AI-pair failure mode above. It does not prove the expected
values are the ones we want; a test can kill every mutant and still pin a
misread spec.

It is deferred until the classifier and the budget guard exist, because a sweep
needs a suite to sweep. See US-018. Two reading rules from the project that ran
one, worth having in advance: a survivor list has a timestamp and can invent
gaps that are already closed, and a file that logs heavily scores low without
being worse tested.

Whenever it happens: **before believing a sweep's number, break a line on
purpose and confirm the sweep catches it.** A number from a harness nobody has
watched fail is worth exactly as much as an assertion nobody has watched fail.
