---
id: US-101
title: The README says what the product does now
type: chore
priority: p2
created: 2026-09-10T04:02+08:00
resolution: shipped
---

## Context

The README stopped being true a long time ago. It says "the skeleton runs, the
product does not", and that "nothing calls" the Reddit connector — written
before US-007, US-009 and US-022. Since then the pipeline has run end to end
against real providers, six platforms are in the build, there is a login, an
onboarding gate, per-account provider and model keys, notifications that
default to on, reply drafts, a CSV export and a paywall.

It is also wrong about smaller things a reader acts on. It names `X_API_KEY`
and `X_API_SECRET`, which no code reads. It says X's provider is a third
account when SocialCrawl is now the provider for four platforms. It says Reddit
has two providers, and it has three. It tells a self-hoster to `docker compose
up` and pull `ghcr.io/rszhd/signalscout:latest`, which US-100 records has never
been published.

The README is the first thing a stranger reads, and every wrong line in it is a
person following an instruction that cannot work.

## Acceptance

- [x] The status section describes what runs today, and names what is still
      unproven, rather than describing the skeleton
- [x] Every platform in `builtInSources` appears, and no platform appears that
      is not in it
- [x] Every provider a reader must open an account with is named, with the
      variable its key goes in, matching `.env.example`
- [x] No environment variable is named that the code does not read
- [x] The cost table's prices match the `pricePerUnitMicros` each connector
      declares
- [x] The install instructions do not tell a reader to pull an image that is
      not published
- [x] The accounts, keys, billing and notification settings are described with
      their real defaults
- [x] The repository table links every document under `docs/`

## Notes

- `README.md` only. `docs/costs.md` has the same staleness in its price table —
  it names four connectors of ten and no per-account keys — and is left for its
  own ticket.

## Log

- 2026-09-10T04:02+08:00 — Added the ticket. The README describes the product
  as of US-005 and the build is at US-100.
- 2026-09-10T04:26+08:00 — Rewrote it. Every price in the cost table is read
  off the connector that declares it, and the per-post figures are the price
  divided by the `postsPerUnit` each connector measured.

  Two things the rewrite found. **`api_usage` on the development database holds
  a row for all ten offered connectors**, so "six platforms have been polled
  with real keys" is checked against the table rather than read out of
  AGENTS.md. And **the "thirty times" figure for X's own API is wrong**: a
  SocialCrawl credit is 8,118 micro-dollars over 20 posts, which is 406 a post
  against X's 5,000 — twelve times, not thirty. The README says twelve.
  `.env.example` and AGENTS.md still say thirty and are left for their own
  ticket.

  Every SQL query in the troubleshooting section was run against the
  development database before it was committed. Two were wrong as written:
  `api_usage` has `estimated_cost_micros` and not `cost_micros`, and the
  monthly total had no month in it.
