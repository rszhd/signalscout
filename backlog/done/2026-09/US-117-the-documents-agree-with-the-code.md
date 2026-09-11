---
id: US-117
title: The documents agree with the code
type: chore
priority: p2
created: 2026-09-11T11:20+08:00
area: docs
resolution: shipped
---

## Context

US-116 fixed one document. This reads the other seventeen and asks the same
three questions of each: is anything here said twice, is anything here no
longer true, and is anything here in the wrong file.

The answer matters more than tidiness, because these documents are what an
agent reads before it writes code. A stale sentence in a document is not a
typo — it is an instruction. Three of the ones found here would have produced
wrong work:

* `docs/secrets.md` told a reader to empty `.env` before opening signup "or
  accept the bill". US-081 made that automatic two days earlier, so the
  document described a hole that is closed and asked for a manual step that is
  now meaningless.
* `docs/sources.md` had a section titled *One platform, one provider* saying X
  has one provider and `registry.only("x")` never has to choose. US-061 added
  the second on 2026-09-07.
* `docs/accounts.md`'s locked-out recovery moves rows to a new account with
  hand-written SQL. It listed six tables of the nine that matter now, so
  following it loses the account's model keys, its provider choices and its
  webhook secret — two of them silently.

STACK.md had grown the same way AGENTS.md did. Its *Source economics* section
was 180 lines of per-platform live measurements, and its LinkedIn section said
in its own words: "Everything below describes that connector as it was
measured... It is history now rather than the shipping path."

## Acceptance

- [x] Every measurement retold in STACK.md is either a structural reason or is
      cut, with `docs/history.md` and `docs/sources.md` holding the evidence
- [x] STACK.md's *What the economics add to the build* describes what exists
      rather than proposing it
- [x] Every claim about the stack matches the code: no Playwright, the real
      repository shape, three pre-filter stages, no published image yet
- [x] PLAN.md's stale sections are corrected in place — the environment
      example, the sources count, the crossings of the *Important rule*, the
      hosted price
- [x] No document tells a reader to do something the code now does for them
- [x] Counts that disagreed now agree: correctness-critical surfaces, the
      columns carrying a provider, the crossings of the rule, the variables in
      the short env file
- [x] The suite figure in `docs/testing.md` is re-measured rather than deleted
- [x] A rule is written in exactly one document, and the others link to it
- [x] Every relative link in every document resolves
- [x] `pnpm lint` passes and the suite is unchanged

## Notes

- PLAN.md was edited in place and neither split nor shortened, which is the
  owner's standing instruction for that file.
- The open tickets in `backlog/todo` and `backlog/doing` point at AGENTS.md for
  measurements that US-116 moved. They were left alone: `docs/history.md` opens
  by saying where it came from, so an old pointer still lands somewhere
  correct, and rewriting another session's tickets is a worse trade.
- `docs/design.md` and `docs/spacing.md` both held the spacing scale. The scale
  now lives once, in `spacing.md`.

## Log

- 2026-09-11T11:20+08:00 — Shipped. STACK.md is 3,621 words against 5,454;
  every other document kept its size and changed its content.

  **The measurement worth keeping is where the staleness was.** Not in the
  documents nobody reads — in the three that are named in AGENTS.md's *Before
  you start a task* list. `sources.md`, `secrets.md` and `costs.md` are the
  ones an agent is told to read before touching a connector, a credential or a
  price, and all three carried a claim that stopped being true within the last
  week. A document's rate of going stale follows the rate of change of what it
  describes, not how often it is opened.

  **Two numbers disagreed inside one file.** `docs/testing.md` said the suite
  was 615 tests in 78.3 seconds in one section and about 41 seconds in the one
  added last week. Re-measured on this machine: **1,922 tests in 112 files,
  74.6 seconds**. Three times the tests for the same wall clock, which is what
  the pg-boss polling change bought.
