---
id: US-018
title: A mutation sweep proves the suite is sensitive
type: chore
priority: p3
created: 2026-09-04T22:54+08:00
parent:
area:
resolution:
---

## Context

[docs/testing.md](../../docs/testing.md) names one failure mode as the reason
the rest of it exists: when an assistant writes both the test and the code, a
single misunderstanding can be encoded twice, and a failing test can be quietly
repaired by weakening the assertion.

A mutation sweep is the systematic check for that. It breaks the code in small
ways and reports which breaks no test noticed. A surviving mutant is an
assertion that does not assert.

It cannot run yet. A sweep needs a suite to sweep, and the suite that matters
here does not exist until the classifier and the budget guard do. Written now,
at p3, so the practice is not reinvented later and the traps below are not paid
for a second time.

Scope is narrow on purpose: the files where a silent wrong answer costs money
or hides a missed lead. Not `packages/core` entire.

    budget guard        spending past a cap
    cursor and dedupe   paying twice for one post
    pre-filter          dropping a good lead silently
    classification      storing an invalid score as a verdict
    encryption          a key that reaches a log

Three traps another project paid for, all still true.

**Default concurrency can take the machine down.** A mutant that turns a loop
bound to zero becomes an unbounded allocation, and a hit-limit counter does not
catch it when the mutated expression sits above the loop. Set a heap cap per
test process so a runaway mutant dies of its own limit and is recorded as
killed.

**The sandbox is not the repository root.** The runner copies the package into
a temporary directory, so a relative path that walks up from `__dirname` lands
somewhere else. Symlink what is read but never mutated.

**A killed mutant can be misreported as a crash.** In that project the first
full sweep reported zero killed and a 1.44% score — a broken harness reading as
a hopeless suite — because the runner parsed test output as TAP and Node's
default reporter had changed. This is why a sweep's own result is never taken
at face value.

## Acceptance

- [ ] A mutation runner is configured over the named files only, and the config
      says why each is in scope
- [ ] Before any survivor is read, a line is broken on purpose in each mutated
      file and the sweep is confirmed to catch it
- [ ] A heap cap is set per test process
- [ ] Paths read but not mutated resolve correctly from the sandbox
- [ ] Every survivor is triaged in this ticket's Log under one of three
      headings: equivalent, with the reason; gap, named to the ticket that will
      add the case; or fixed here
- [ ] The command to run a sweep is documented in `docs/testing.md`
- [ ] No score floor is set in CI until the numbers have been triaged once —
      a file that logs heavily scores low without being worse tested

## Notes

- Depends on [US-009](US-009-the-model-scores-a-post-against-a-monitor.md) and
  [US-013](../done/2026-09/US-013-a-monitor-cannot-spend-past-its-budget.md). There is nothing
  to sweep before both exist.
- Stryker is the runner for a TypeScript suite. Confirm the reporter setting
  against the Node version in use before the first run.
- A sweep proves sensitivity, not correctness. A test can kill every mutant and
  still pin a misread spec. The right expected value stays a human question.
- Read the survivors; do not chase zero. Some mutants are equivalent and
  unkillable without contorting the code.
- A survivor list has a timestamp. Check the run's start time against
  `git log` before believing a low score, or you will triage gaps that newer
  tests already closed.

## Log

- 2026-09-04T22:54+08:00 — Written while adopting docs/testing.md. Deferred deliberately:
  the traps above are worth nothing until there is a suite to sweep, and they
  will still be true then.
