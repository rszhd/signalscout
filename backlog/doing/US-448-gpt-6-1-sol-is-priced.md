---
id: US-448
title: gpt-6.1-sol is priced
type: feature
priority: p2
created: 2026-10-02T09:24+08:00
parent:
area: ai
resolution:
---

## Context

The owner moved every gpt-6-sol and gpt-5.6-sol use to gpt-6.1-sol, in the
hosted application and in a private experiment on these packages (US-434).
The engine prices a call from `modelPrices`; a model with no row is recorded
at no cost, so a cap, a budget or a usage figure built on `model_calls`
would leave its calls out.

## Acceptance

- [x] `modelPrices` has gpt-6.1-sol at $2.00 a million input tokens and
      $10.00 output, from OpenAI's pricing page, read 2026-10-02.
- [ ] Released, and the hosted application moved to that version.

## Notes

- `packages/engine/src/ai/provider.ts`.
- The experiment set the price by setting until this ships.

## Log

- 2026-10-02 09:24 — Opened and built. OpenAI's page: gpt-6.1-sol $2.00 in,
  $10.00 out, the same as gpt-6-sol; gpt-5.6-sol is $4.00 and $20.00.
