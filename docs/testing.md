# Testing philosophy

The rules the tests follow, what we deliberately do not test, and the one
thing that changes when the code is written by an AI assistant rather than a
second person. Most rules here were paid for in another repository; the
incidents behind them, and this project's own measurements, are in
[history.md](history.md) under *Testing*.

---

## What we practice

**Spec-driven, test-alongside.** The ticket is the contract and its reasoning
is written before the code. The test ships in the same commit as the feature.
Not test-first everywhere, and not test-later.

**The fastest fake that still catches the bug you care about.** Most
assertions belong in plain unit tests over `packages/engine`, which needs no
database, network or clock. Reach for a heavier shape only when the lighter
one cannot hold the claim up. **Same feature, two tests, when the shortcut one
layer takes lies about the thing the other must verify** — and say the lie
out loud before writing the second test. For ordinary CRUD, one test from the
route to the database covers routing and persistence together.

**A screen is driven through the DOM a person uses.** `apps/web/src/testing.tsx`
mounts a screen into a real document, finds an element by its label or by the
words on its button, and sets a value through the native setter React listens
to. A test that reaches into props can pass with the control unreachable.
Spend that harness on interactions that carry a decision — submitting the
form, giving a verdict, showing a failed request. A class, a heading or a
colour does not owe the suite a case.

**Real Postgres from the first test file. No in-memory stand-in.** Two
load-bearing pieces are exactly what a fake gets wrong: `pgvector` distance
and `pg-boss` claiming a job. A uniquely named database per test file,
migrations applied, dropped after, costs a few hundred milliseconds.

**Two migration streams, one database.** The pipeline's tables come from
`packages/pipeline/drizzle` and the account tables from `apps/api/drizzle`,
each under its own migrations table. A pipeline test gets the pipeline's
stream; a test in `apps/api` uses that package's own `createTestDatabase`,
which applies both. Each stream has a `migrations.test.ts`, and
`pnpm db:generate` runs `drizzle-kit` for both.

**No test spends money.** No test may reach the Reddit API, the X API or a
model provider. An X read costs $0.005 and a test loop does not stop when the
assertion passes. The metered connectors take an injected HTTP client, and the
test setup makes the real one unreachable rather than merely unused. A test
that would spend money must fail loudly.

**Speed and hermeticity are features.** A fast suite with no network is what
lets an assistant run everything after every change and correct itself. Run
the files you touched while you work, and the whole suite before you call the
work done.

---

## Working with an AI pair changes one thing

With two people, the one who writes the test and the one who writes the code
reach the answer independently, so a shared misunderstanding has two chances
to be caught. When an assistant writes both, that independence is gone: a
test can encode one misunderstanding twice, and a failing test can be "fixed"
by weakening the assertion. The mitigations, in order of leverage:

**1. Anchor the expected value to intent, not to the implementation.** An
assertion is trustworthy when a person can read the input, agree the expected
output is right, and never look at the code. Prefer a literal a human can
check over one the test derives the way the code does.

**2. See it fail, where test-first did not already buy it.** On a test
written beside or after the code, break that code on purpose and watch that
one file go red. This is a substitute for test-first, not an addition: the
three surfaces written test-first caught every deliberate mutation the first
time, and every gap came from a surface written alongside. A full mutation
sweep is US-018's job, not a ticket's.

**3. Test against the real thing, not the assistant's fake.** A fake written
by the same author will agree with buggy code.

**4. Test-first on correctness-critical surfaces.** The assertion is written
and reviewed first, and the implementation is written against it:

| Surface | The shape of the failure |
|---|---|
| Budget guard | Money is spent past a cap, silently, while nobody is watching |
| Cursor and deduplication | The same post is fetched and billed twice |
| Credential encryption | A key reaches a log line or an API response |
| Classification schema | An invalid score is stored as if it were a verdict |
| Deletion reconciliation | Content the author removed keeps being shown |
| Session gate | A route answers a stranger, and looks completely normal doing it |
| Entitlement | An account that stopped paying keeps polling, on our bill |

Each file carries a `Correctness-critical` header naming the failure and the
tests that pin it: `grep -rl 'Correctness-critical' packages/*/src apps/*/src`.

The session gate is the one whose test cannot be a sample: it is a claim
about *all* the routes, and the route added next month is the one that will
not be checked. So `apps/api/src/auth.ts` records what it registered, and
`auth.test.ts` walks that list against a written list of open paths.

**5. A red test is fixed in the code, not in the assertion.** An expected
value changes only when the behaviour was *meant* to change, and the commit
says which and why. The one other way it moves: the assertion was wrong the
day it was written, and the commit quotes the line of the ticket that says
what was meant. "The code looks right, so the test must be wrong" is the
failure this section exists to prevent, and it wears the same words.

---

## A fixture for someone else's API is captured, not written

A fixture we wrote is evidence about our parser and never about the wire
format. Reddit and X payloads are the entire input of this product, so:

- Every source fixture is captured from a real response by a committed,
  re-runnable script.
- The payload is stored whole, with identifying fields scrubbed.
- A ticket that changes a parser moves the fixture too.
- An assistant never writes a payload from memory. A plausible Reddit
  response is the exact failure this rule exists to prevent.

## Testing the model

Two questions, two instruments. **Does the code handle the model correctly?**
Recorded responses replayed through the real classifier: deterministic, free,
in CI, covering schema validation, a refusal, a timeout, an out-of-range
score, a malformed response. **Is the scoring any good?** No test in CI can
answer it. PLAN.md's worked examples are the labelled set; grow it from real
matches and feedback. It runs by hand against a live provider when the prompt
or the model changes, and the results go in the ticket that changed it:

    pnpm --filter @signalscout/engine capture:classifier

The bands `ai/examples.test.ts` asserts were written before the first run, and
the house rule applies to them.

---

## Rules that catch silent failures

Every rule here exists because something was green while being broken.

**A broad `catch` obliges an assertion on the happy path of the thing it
wraps, driven the way production drives it.** Our version of the trap is the
classifier: a model error is meant to leave a post unclassified and
retryable, and if the same catch swallows a programming error, an empty inbox
reads as a quiet day. Testing the parts is not a substitute; the swallow lives
in the seam between them.

**A deliberately swallowed error needs a test that fails when the swallowed
thing does.** We have two by design: an embedding failure sends the post to
the model rather than dropping it, and a source outage is not a deletion.
**Count the branches of a swallow, not the swallows**: the pre-filter fails
open in two places, and one case covered only the first.

**A rule is only as tested as its least-tested caller.** The symptom is always
the same: the feature works when a person clicks it and does nothing at
02:00. After "is this rule asserted?" comes "how many places call it, and does
each have its own case?" Answer by deleting the call from one site at a time
and checking that something turns red.

**A guard whose pass and fail share an answer is guarding nothing.** The
inputs that separate a guard from its absence are the ones that take a
different code path, not the ones that look most malformed. **An
assertion-first case that passes immediately owes an explanation**, written
in the ticket before the case is kept.

---

## What a green suite cannot say

**A green suite says the code does what we modelled. It never says the model
was right.** When a change rests on third-party behaviour — a rate limit
header, a payload shape, an OAuth refresh — the suite covers our half only,
and the claim is unproven until it has run somewhere real. Budget that step
into the ticket. The largest instance is the product itself: no test says the
matches are worth reading.

## A measured constant needs a committed instrument

A test can pin what the code does with a number; nothing in a suite can say
the number is right. The similarity threshold, the minimum score that makes a
match, and the weight of age in the inbox ordering are this shape. Each owes
the repository the command that produced it, committed and re-runnable, plus
the numbers and the date. Each default starts permissive: a silent false
negative is worse than a noisy inbox.

## Two diagnostics

**A wait in milliseconds is a race, not an ordering.** Wait on something that
has definitely happened. Widening a timeout hides a real defect inside the
same number a busy machine produces.

**When the suite goes flaky, run the suspect file alone.** A fault that
survives being run by itself is not a scheduling fault.

## What we do not test, and why that is a choice

- **Live third-party APIs**: captured fixtures. A live test can be rate
  limited, can fail on someone else's outage, and on X can be billed.
- **Live model providers in CI**: recorded responses. Quality is answered by
  the labelled set, by hand.
- **Full user journeys and a real browser.** A screen test mounts one screen
  into jsdom. Nothing walks from the form through the worker to the inbox, and
  nothing runs in a browser engine. That path is checked by hand, and the
  ticket that does it budgets for the run.

## When to stop

**Stop when every acceptance box is verified, when the changed behaviour has
a test somebody has watched fail, and when no concrete concern is left
unanswered.** "There could be an edge case" is not a concern. "The deletion
job calls this rule and has no case" is. A test added because the suite felt
thin proves nothing and is maintained for ever.

## Deferred: mutation testing

A sweep proves sensitivity — that no test passes no matter what — and not
that the expected values are the ones we want. The suite is now worth
sweeping, so US-018 waits on somebody. Before believing a sweep's number,
break a line on purpose and confirm the sweep catches it.

---

## Running the suite

`pnpm test` uses a real Postgres and creates a database per test file. If it
cannot reach one it says so; it does not fall back to a fake.

**Which Postgres is the folder's own.** The suite reads `DATABASE_URL` from
the `.env` beside it: the container `pnpm db:up` starts on 5432 in the main
checkout, or the worktree's own container under its own
`COMPOSE_PROJECT_NAME` in a worktree made by `scripts/new-worktree.mjs`.

**It can go red without a broken test.** A database per file, in parallel,
can outrun Postgres `max_connections` of 100: a file fails with "sorry, too
many clients already", sometimes as a 500 from a route whose insert got no
connection. The failing file moves between runs and passes alone. Check that
before reading a red run as a regression. `vitest.config.ts` holds it off with
`DATABASE_POOL_SIZE` at three per pool and `maxWorkers` at four. Pass
`--maxWorkers` by hand only to go lower: six workers were tried, and
`classify.test.ts` failed two runs in four under load.

**A worker test that costs seconds a test is a polling interval.**
`WORKER_POLLING_INTERVAL_SECONDS` is set to pg-boss's floor of 0.5 for the
suite alone; it once accounted for 397 of 435 seconds of file time. If a
worker file starts costing seconds a test again, look there first, and
`--reporter=json` gives the per-file timings.
