---
id: US-103
title: The README is an overview
type: chore
priority: p2
created: 2026-09-10T09:52+08:00
resolution: shipped
---

## Context

US-101 made the README true and left it long: 468 lines holding a per-connector
price table, five SQL queries, a settings table, the proxy commands and the
argument about why each platform arrives through a data provider. That detail
is right, and the README is the wrong place for it.

A README is read once, by somebody deciding whether to keep reading. Detail
belongs in the document that owns the subject, where it can be maintained
beside the thing it describes — and this repository already has nine such
documents plus STACK.md and PLAN.md.

The duplication is the real cost. The cost table restates `docs/costs.md`, the
settings table restates `.env.example` and `docs/accounts.md`, and the proxy
commands restate `docs/accounts.md`. Three copies of one fact drift until two
of them are wrong, and the reader cannot tell which.

There is no document that owns self-hosting end to end. `docs/accounts.md`
holds TLS and the login, `docs/secrets.md` holds the keys, and the install
itself lives only in the README. That is why the detail has nowhere to go yet.

## Acceptance

- [x] `docs/self-hosting.md` holds the install, the settings, the proxy and
      the troubleshooting queries, and is linked from the README
- [x] The README's cost section is a short statement with a link to
      `docs/costs.md`, not a per-connector table
- [x] No section of the README restates a fact that a `docs/` page owns
- [x] The repository table still links every document
- [x] The README is materially shorter, and a reader can still answer: what is
      it, does it work, what will it cost me, how do I run it

## Notes

- `docs/costs.md` is stale in the same way US-101 found the README to be: its
  price table names four connectors of ten. Moving the README's table there is
  the chance to fix it.
- Do not move the honesty. The status section's unproven list and the sentence
  about a data provider putting the compliance burden on the reader are the
  two things a stranger most needs before they start, and both stay.

## Log

- 2026-09-10T09:52+08:00 — Added the ticket, on the owner's instruction that
  the README should be an overview that links out.
- 2026-09-10T10:05+08:00 — Shipped. The README is 241 lines against 468.
  `docs/self-hosting.md` is new and owns the install end to end, which is the
  document that did not exist and is why the detail had nowhere to go.

  **Moving the price table into docs/costs.md found two wrong claims there, and
  one of mine.** That page still said LinkedIn is the dearest platform at
  $0.0041 a post through SocialCrawl — a connector US-053 switched off — and
  that a LinkedIn search matching nothing is billed in full, which is now one
  case of a general rule covering YouTube and Instagram too. The dearest item
  is an Instagram comment at $0.0027.

  My replacement for that paragraph called it ten times a LinkedIn post and
  eighteen times a Reddit record. Both were wrong: it is 1.35 and 1.80.
  Recomputing from the connectors gave the true comparisons — fifteen times a
  YouTube video and thirteen times a SocialData tweet. **A ratio written from a
  sense of proportion is not a ratio.**

  Nothing about the honesty moved. The unproven list and the paragraph saying a
  data provider puts the compliance burden on the reader are both still in the
  README, where a stranger meets them before they start.
