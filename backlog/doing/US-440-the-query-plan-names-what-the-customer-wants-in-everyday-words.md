---
id: US-440
title: The query plan names what the customer wants, in everyday words
type: feature
priority: p2
created: 2026-09-30T09:42+08:00
parent:
area: ai
resolution:
---

## Context

US-418 made the query prompt ask for the topic in the person's words, two or
three words, with no ask words, best first. That holds. What still produces
weak plans is the rule beside it: "prefer the words of the problem over the
words of the category", with every example taken from one kind of product.

A private experiment on these packages (US-434) wrote its own prompt and
compared the two on the same page descriptions, with no search:

- The package's prompt, one query per platform, gave "customer
  conversations" and "social listening" for signalscout.run: 54 posts, none
  about a product like it. Support teams write "customer conversations"
  every day.
- A first rewrite whose examples were all from lead-finding copied them onto
  other products ("find comfortable shoes"), refused everyday category names
  ("password manager"), and followed each page's newest feature (Zapier
  "govern AI agents").
- The version that worked: examples from four kinds of product; an everyday
  category name allowed when ordinary people use it ("password manager",
  "running shoes"), jargon refused ("intent monitoring", "AI governance");
  the product's main everyday use, not its latest campaign; three different
  ways in (the thing, the task, the situation) instead of one idea with
  another verb; the situation in a customer's complaint words, never an
  industry term ("forgot password", not "shadow IT").
- With it, signalscout.run got "find leads | find customers | find users",
  the three best queries on SignalScout's own production monitors (US-418's
  Log). Live, allbirds.com found 18 matches and invoiceninja.com 11.

**This is evidence from one experiment, not a measurement of this product.**
It covered X and Reddit only, one scan a page, about twelve pages, and its
examples contain SignalScout's own best queries, so signalscout.run is a
biased test. A monitor here writes 3 to 8 queries for up to six platforms,
each with its own rules, and polls often; the same phrases would find other
posts here.

So the change carries the five ideas into `buildQuerySystemPrompt` and keeps
everything else: the per-platform rules and word limits, the 3-to-8 count,
best first, no ask words, the subreddit section.

## Acceptance

- [ ] `buildQuerySystemPrompt` gives examples from several kinds of product,
      allows an everyday category name and refuses jargon, writes for the
      main everyday use, and asks for different ways in, with the situation
      in complaint words.
- [ ] The per-platform rules, the word limits and the 3-to-8 count are
      unchanged, and `usablePlanFrom`'s tests pass as they are.
- [ ] The query capture (`ai/fixtures/capture-queries.ts`) is re-run before
      and after on the same projects, and the Log lists the phrases side by
      side. The cost is said before it runs (`docs/instruments.md`).
- [ ] Two or three real monitors' plans, old and new, are run once each, and
      the Log gives posts and matches per phrase.
- [ ] The owner decides the release: it changes the queries of every new
      monitor, in both applications.

## Notes

- `packages/engine/src/ai/queries.ts`, `buildQuerySystemPrompt`.
- The experiment's prompt, for comparison: `signalscout-lookout`,
  `src/worker/queries.ts` (private repository), commits 1edda86..29c347e.
- Related: US-418, whose last acceptance box — a live run of old and new
  phrases — is the same measurement and can be done once for both.

## Log

- 2026-09-30T09:42+08:00 — Written on the owner's word, from US-434's comparisons.
- 2026-09-30T09:46+08:00 — Prompt changed. The first paragraph now asks for the everyday
  name of the thing, the task or the situation, for the main everyday use;
  an everyday category name is allowed and marketing words are refused;
  examples come from four kinds of product; the ways-in paragraph names the
  thing, the task and the situation, the situation in complaint words. The
  US-418 sentences its tests quote are unchanged. The Reddit note in
  `platforms.ts` still says "not the words of the product category"; it is
  US-385's text and is left alone, and the new rule reads it as the
  marketing words. No model has seen the new prompt yet.
