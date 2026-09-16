# Changelog

`@signalscout/engine` and `@signalscout/pipeline` share this file, because they
share a version. Both are published from one tag, and the pipeline depends on
the engine at that exact version. Upgrade both, or neither.
[docs/releasing.md](docs/releasing.md) is how a version is cut.

**An entry says what a consumer must know**, not what the diff shows. A renamed
export, a changed option, a table that moved: those belong here. A refactor
nobody outside this repository can see does not.
[docs/history.md](docs/history.md) is the other record — every ticket, in the
order it happened, including the ones that changed nothing a consumer imports.

Before 1.0, a change a consumer must react to moves the minor and anything else
moves the patch. The app in this repository is not versioned and is not
described here; it is what `main` holds.

## Unreleased

Nothing yet.

## 0.1.2 — 2026-09-16

Nothing to do. The packages are published through npm trusted publishing now,
so no token exists anywhere. No code changed between 0.1.1 and this.

## 0.1.1 — 2026-09-16

**Added.** `@signalscout/pipeline/testing` exports `insertMonitor` and
`fastRetries`. A consumer's test can now build a monitor row and make a retry
policy take no real time, the way this repository's tests do.

Nothing else changes.

## 0.1.0 — 2026-09-16

First publish. The split that US-152 and US-153 made, as npm packages.

**`@signalscout/engine`** — stateless. Connectors for Reddit, X, LinkedIn,
YouTube, TikTok and Instagram through Bright Data, ScrapeCreators, SocialCrawl,
SocialData and Apify, behind one `SocialSource` interface. Model calls over the
Vercel AI SDK: query writing, triage, classification, reply drafting,
embeddings. The pre-filter's keyword stage, the cost arithmetic, the
AES-256-GCM cipher, and the product's vocabulary. Test helpers at
`@signalscout/engine/testing`.

**`@signalscout/pipeline`** — stateful. The monitor, post, match, ledger and
budget tables with their migrations; the five queues and the scheduler that
feeds them; the budget guard; notification delivery by email and webhook. Test
helpers at `@signalscout/pipeline/testing`.

**The boundary, which is the point of publishing at all.** The engine reads no
environment variable and declares no database. The pipeline owns only its own
tables and knows an owner as a text id. Neither knows an account. Login,
billing and the rule for who may poll belong to the application on top.

**Requires.** Node 24 or newer, ESM only. The pipeline needs one Postgres 17
database with `pgvector`, and nothing else.
