---
id: US-124
title: DeepSeek is a model provider
type: feature
priority: p2
created: 2026-09-11T18:46+08:00
parent:
area: ai
resolution:
---

## Context

**DeepSeek is a name in a list, and that is the whole point of `provider.ts`.**
Anything that is not OpenAI, Anthropic or Google goes through
`createOpenAICompatible` with a base URL. DeepSeek serves an OpenAI-compatible
API at `https://api.deepseek.com`, so this ticket ships no new package and no
new code path. The database does not stand in the way either: `ai_keys.provider`
and `ai_settings.provider` are plain text with no check constraint, so there is
no migration to write.

**This ticket carries no price row, and that is the decision in it.**
`modelPrices` holds one input number and one output number for a model. DeepSeek
publishes four bands for each of its two models — peak hours and off-peak hours,
each split into cache hit and cache miss. For `deepseek-flash`, one million
input tokens is $0.003 at the cheapest band and $0.30 at the dearest. A single
number would be wrong by a factor of one hundred, and it would sit in a table
whose rule is that every row was read off a page as one figure. Our ledger
cannot see a cache hit either, so we could not pick the right band even if we
held all four.

**The pricing page also says `deepseek-v4-pro` requests are routed to V4.1 Flash
and billed at the Flash price from 2026-09-14.** A v4-pro row would therefore be
wrong four days after it was written. This is the second reason not to price
either model, and it is the same failure Google's `gemini-3.8-flash` is kept out
of the table for: a price that becomes wrong on a date nobody is watching.

**So DeepSeek gets OpenRouter's shape.** The provider works, a key can be added
and tested, the screen asks for a model name because this build can recommend
none, and calls record no cost until somebody sets a price. That is the honest
answer and a self-hoster can act on it: `AI_INPUT_PRICE_MICROS` and
`AI_OUTPUT_PRICE_MICROS`, or the per-task price override on the Models screen.

**No embedding.** DeepSeek documents no embeddings endpoint, so it stays out of
`embeddingProviders` for Anthropic's reason. A deployment that named it there
would fail every call at run time; leaving it out makes that a startup message.

**One half of this cannot be proved here.** DeepSeek's JSON guide documents
`response_format` as `json_object` only, with no `json_schema`. Our
`generateObject` call then falls back to JSON mode with the schema in the
prompt, which should work and is what the OpenAI-compatible provider does for
every gateway already. No test may make that call. The proof is one key added on
the Models screen and one press of Test, which costs a fraction of a cent.

Read 2026-09-11 from `api-docs.deepseek.com`: the pricing page, the overview and
the JSON output guide.

## Acceptance

- [x] `deepseek` is in `aiProviders` and in the providers that need a key
- [x] `deepseek` is not in `embeddingProviders`
- [x] `createModel` builds an OpenAI-compatible client at
      `https://api.deepseek.com/v1`, and `AI_BASE_URL` still overrides it
- [x] `AI_PROVIDER=deepseek` passes environment validation, and
      `AI_EMBEDDING_PROVIDER=deepseek` does not
- [x] No row is added to `modelPrices`, and `recommendedModelFor` answers null
      for every task on DeepSeek, asserted like OpenRouter's
- [x] A key naming `deepseek` is accepted by the models route, and
      `testModels` carries no DeepSeek entry
- [x] The Models and Onboarding screens show "DeepSeek" and its icon
- [x] `.env.example` and `docs/self-hosting.md` name the provider
- [x] The Log says the structured-output call is unproven until it runs live
- [x] A real DeepSeek key answers the structured call: added on the Models
      screen, tested, and the answer recorded in the Log

## Notes

- Nothing outside `ai/provider.ts` names a provider. Keep it that way: the base
  URL belongs in `defaultBaseUrls` beside OpenRouter's and Ollama's.
- `recommended.ts` holds the list of providers it says nothing for, with a
  reason each. Add DeepSeek's reason there rather than in a commit message.
- The brand icon is downloaded once into `apps/web/public/brands/` and recorded
  in that folder's README. The UI makes no external favicon request.

## Log

- 2026-09-11T18:46+08:00 — Written. The owner asked whether DeepSeek can be
  included. US-123 was taken by another session, so this is 124.
- 2026-09-11T19:02+08:00 — The backend half is done and the suite passes: 1,954
  tests, 114 files. `deepseek` is a provider that needs a key, cannot embed, and
  reaches `https://api.deepseek.com/v1` unless `AI_BASE_URL` says otherwise.
  `ai/provider.test.ts` is new and asserts the host by reading the URL the built
  client would call, because asserting our constant against our constant would
  pass with the host spelled wrong. No price row and no recommendation, for the
  reason in Context; `docs/costs.md` now carries that decision where a person
  looking for a missing figure will read it.

  **The structured call is unproven.** DeepSeek documents `response_format` as
  `json_object` only. The AI SDK's compatible client reports
  `supportsStructuredOutputs: false`, so `generateObject` falls back to JSON
  mode with the schema in the prompt — the path every gateway already uses here.
  No test may make that call. Add a key on the Models screen, press Test, and
  this is settled for a fraction of a cent.

  The screens are not done: `Models.tsx` and `Onboarding.tsx` show the raw name
  `deepseek` and a two-letter placeholder until the label maps and the icon are
  added.
- 2026-09-11T19:00+08:00 — The screens are done. Both `providerNames` maps name
  DeepSeek, `BrandIcon` points at `deepseek.png`, and the file is the site's own
  favicon resized to 64 pixels — the original is 225 pixels and 205 KB, five
  times the largest icon here, for something drawn at 20. `Models.test.tsx`
  asserts the picker says "DeepSeek" and leaves the model field empty, which
  covers the label and the missing recommendation in one case; it fails when the
  label is removed. The suite passes: 1,955 tests, 114 files. No browser has
  rendered the icon.
- 2026-09-11T19:04+08:00 — Added the last box. Everything the suite can prove is
  proved, and the one call that decides whether DeepSeek scores at all has not
  been made. The ticket stays in `doing/` until somebody presses Test with a
  real key.
- 2026-09-11T19:20+08:00 — The owner added a real key on the Models screen and DeepSeek refused
  the call: *Prompt must contain the word 'json' in some form to use
  'response_format' of type 'json_object'.* That is BUG-018, which is bigger
  than this ticket — the compatible client never sent the schema for OpenRouter
  and Ollama either. Fixed there.

  The owner also found the model field blank on the key dialog. That was this
  ticket's own decision working as designed and reading as a gap, so the
  decision is now split in two: a **recommendation** still needs a price,
  because it puts a job on a model with nobody watching, and a **name** does
  not. `provider.ts` carries DeepSeek's two model names as `unpricedModels`,
  read off its page today. The key dialog prefills the first, the job cards
  offer both, marked "no price carried", and `recommended.ts` still chooses
  neither. The suite passes: 1,961 tests.
- 2026-09-11T19:24+08:00 — DeepSeek works. The owner added a key on the Models screen and the
  probe answered: `deepseek-flash`, 149 input tokens, 21 output, 1,177 ms, and
  `estimated_cost_micros` null — which is this ticket's own decision showing up
  in the ledger exactly as intended. It took BUG-018 to get there; the refusal
  at 11:02 UTC and the answer at 11:15 UTC are both recorded.

  What is proved: the provider takes a key, answers a structured call, and its
  cost is recorded as "we cannot say". What is not: no poll has run on DeepSeek,
  so nothing has scored a real post with it, and no browser has rendered the
  icon. Closed.
