---
id: US-572
title: A product description is written in English, whatever the page's language
type: feature
priority: p2
created: 2026-11-12T15:40+08:00
parent:
area: ai
resolution:
---

## Context

The describe prompt named no language, so the model chose one: usually the
language of the page or the typed text, and not always the same one twice. A
Malay page could give a Malay product, ideal customer and problem.

Those three fields are read by the classifier, whose prompt is English, and
shown on screens and in emails written in English. One language keeps them
consistent. The owner chose English for every description (2026-11-12).

A name, a place and a local word stay as the page writes them: "Lembah
Klang", "cuci homestay". Search phrases are not this prompt's job; a caller
that writes them decides their language.

## Acceptance

- [x] The describe prompt asks for every field in English and keeps names, places and local words.
- [x] A Malay and a non-Latin-script input each give English fields on the model the hosted product describes with.
- [ ] Released in a version.

## Notes

- Prompt: `packages/engine/src/ai/describe.ts`, `buildDescribeSystemPrompt`.

## Log

2026-11-12T15:55+08:00 — Four typed inputs on claude-opus-5-5, the hosted product's describe model: Malay (homestay cleaning), Indonesian (catering), Spanish (guitar lessons), Chinese (aircon cleaning). Product, ideal customer and problem came back in English for all four. Places stayed as typed: "Lembah Klang", "Jakarta Selatan". The name followed the input once ("Servis cuci homestay").
