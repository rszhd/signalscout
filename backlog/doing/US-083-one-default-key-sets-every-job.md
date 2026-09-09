---
id: US-083
title: One default key sets every job
type: feature
priority: p1
created: 2026-09-09T11:13+08:00
parent: US-079
area: models
resolution:
---

## Context

**A person pastes one key and nothing runs.** US-079 made a key a row on the
account and a job a pointer at one, which is the right shape and one step short
of useful. The four jobs still point at "this instance's key", and US-081 took
the machine's keys away from every instance that takes registrations. So on the
cloud a new account adds a key and scoring, triage, similarity and drafting are
all still dead.

Getting them working is nine actions: open four cards, choose the same key four
times, and name a model in each one — because `AI_MODEL` is `claude-haiku-4-5`,
a name OpenAI does not answer to, so a job moved off the instance's provider is
refused a save until somebody types a model. The screen asks a person who has
just said "this is my OpenAI key" to answer four more questions that all follow
from it.

**One of those keys is the default, and the jobs follow it.** The account marks
one key default. A job with no settings row of its own runs on that key, on
that key's provider, on the model this build recommends for that job on that
provider. Change the default and every following job moves with it, on the next
call, because nothing was written down to go stale.

**Following is the absent row.** That is the same idea the rest of this area is
built on — AGENTS.md, US-068: *a stored row is an override*. A job somebody has
edited has a row, and a row is what "I chose this myself" means, so the default
never overwrites a choice. Clearing the row is how a person hands the job back,
which is the button that already exists under another name. No flag, no column
for one, and no migration to add one.

**A recommendation is a fact about someone else's product**, so the table is
read from the providers' own pricing pages, like `modelPrices` beside it. Read
2026-09-09:

| Job | OpenAI | Anthropic | Google |
|---|---|---|---|
| Scoring | `gpt-5.6-terra` | `claude-sonnet-5` | `gemini-3.5-flash` |
| Triage | `gpt-5.6-luna` | `claude-haiku-4-5` | `gemini-3.5-flash-lite` |
| Similarity | `text-embedding-3-small` | none | none |
| Drafting | `gpt-6-astra` | `claude-fable-5-1` | `gemini-3.1-pro-preview` |

Every triage model is cheaper than the scoring model beside it, which is the
whole of US-030's finding: with no price gap the stage costs more than it
saves, and a recommendation that ignored that would ship the loss by default.

**Three providers get less than four models, and each for its own measured
reason.** Anthropic publishes no embedding endpoint, which `config.ts` has said
since US-008. Google's embedding models do reach 1536 numbers, but only when
the request carries `output_dimensionality`, and `embed.ts` sends no such
parameter — so a Gemini embedding today comes back 3072 wide, is refused by the
width check in `embed.ts`, and is billed anyway. OpenRouter resells 400 models
at the upstream provider's prices, so a price snapshot for it would be a guess
sitting in a table whose whole rule is that it holds only checked facts. Ollama
runs whatever somebody pulled, and costs nothing either way.

## Acceptance

- [x] An account marks one stored key as the default, and marking a second
      unmarks the first
- [x] The first key added to an account with no keys becomes the default
      without anybody asking for it
- [x] A job with no settings row runs on the default key, that key's provider,
      and this build's recommended model for the pair
- [x] Changing the default moves every following job on the next call, with no
      restart and nothing rewritten in the database
- [x] A job a person saved keeps its own key, provider and model when the
      default changes
- [x] Clearing a job's settings makes it follow the default again, and the
      button says so rather than saying "instance defaults"
- [x] A provider with no recommendation for a job — Anthropic similarity,
      Google similarity, OpenRouter, Ollama — leaves the model unset, and the
      card says the job needs a model named
- [x] The Models screen shows, for each job, what it will actually run and
      where that came from: the default key, or the job's own settings, or the
      instance
- [x] Deleting the default key leaves no default, and every following job says
      it cannot run rather than failing at the next poll
- [x] `modelPrices` gains the models the table names, with the date the price
      was read, and `pricedModelsFor` returns them per provider
- [x] The recommendation is one function, read by the API view, the save route
      and the worker's overlay — not three copies
- [ ] A real browser has rendered the screen and moved a default

## Notes

- Read `packages/core/src/ai/settings.ts` first. `overlay` is where a following
  job resolves, and its `moved` rule — a job that changed provider must not
  inherit a key from the old one — is the rule this ticket must not break.
- The default belongs on `ai_keys` as a column, with a partial unique index per
  account. Two defaults is the failure, and the index is what makes it
  impossible rather than unlikely.
- Correctness-critical: credential encryption. Nothing here reads a key back
  out; the default is a boolean beside the mask.
- **Do not fill the price table from memory.** The four prices this ticket adds
  came from the providers' own pages on 2026-09-09: `gpt-6-astra` $10.00/$50.00,
  `claude-fable-5-1` $10.00/$50.00, and the Gemini line as recorded above.
- Two prices carry a date and both are written down as comments rather than
  used. `gemini-3.8-flash` is $0.75/$3.75 only until 2026-12-31 and then
  doubles, so it is not recommended — a price that expires becomes wrong in
  silence. Gemini's Pro models are priced in two bands by context size, and the
  table takes the band under 200k tokens, which is every call this product
  makes.
- Google similarity is a second ticket if anybody wants it: send
  `output_dimensionality: 1536`, then measure the width against a real call,
  because no test in this suite may spend money to prove it.
- The recommendation is a starting point and never a correction. It fills a job
  that has no answer; it never replaces a model somebody typed.

## Log

- 2026-09-09T11:13+08:00 — Written after the owner asked for a default key per
  account with jobs following it. The provider pricing pages were read the same
  hour, which is where the model table comes from and why `gpt-6-astra` is in
  it: it was doubted, checked, and it exists.
- 2026-09-09T11:35+08:00 — Built. 1,584 tests pass, lint and typecheck clean.
  Migration 0052 adds the column and the partial unique index, and **backfills
  nothing**: marking an existing account's only key as the default would move
  every untouched job onto a different provider, a different model and a
  different bill, through an upgrade nobody read a note about. Every existing
  instance keeps exactly what it had.

  Three things came out differently from the plan. **The `db:generate` command
  has been broken since 0038** — two snapshots share an id — so this migration
  is hand-written like every one since 0039, and `meta/_journal.json` needs the
  entry or the test databases never see it. **`gpt-6-astra` is real**: the
  ticket doubted the name and the pricing page settled it at $10.00 and $50.00,
  which is the second time here that reading a provider's own page beat
  reasoning about it. And **the rule for whether a job may follow a key had to
  become a function**, `followsDefault`, because the screen and the worker both
  ask it — a screen answering separately would promise a call the worker never
  makes.

  Three old cases in `ai/settings.test.ts` went red, and all three were the new
  behaviour arriving where a test had assumed no default could exist. Each now
  says which world it is in through a `clearDefault()` helper, so the old rule
  is still asserted rather than quietly replaced.

  Unproven: no real browser has rendered any of it. The screen is driven
  through jsdom, and nothing has moved a default in Chrome.
