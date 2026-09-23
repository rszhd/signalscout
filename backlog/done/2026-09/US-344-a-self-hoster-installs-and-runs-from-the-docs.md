---
id: US-344
title: A self-hoster installs and runs SignalScout from the docs
type: feature
priority: p1
created: 2026-09-23T10:50+08:00
parent: US-342
area: docs
resolution: shipped
---

## Context

`docs/self-hosting.md`, `docs/notifications.md`, `docs/secrets.md`,
`docs/accounts.md` and `docs/costs.md` each carry a self-hoster's half and a
contributor's half. The self-hoster's half moves to the site, rewritten for
somebody running the image; the contributor's half stays at its path, so no
reference in code breaks.

**The configuration reference is generated, not copied.** `.env.example`
already names every setting with its reason, and a second hand-written
table is the drift BUG-339 spent a morning finding.

## Acceptance

- [x] *Self-hosting*: install, TLS and the proxy, providers and keys, models,
      email, webhooks, backups, upgrading, key rotation, troubleshooting.
- [x] A configuration reference built from `.env.example` at build time.
- [x] The webhook contract is one page a receiver can be written from.
- [x] Each repository page that lost its self-hoster half opens with one line
      pointing at the site, and keeps what a contributor needs.
- [x] The README's install section links to the site rather than repeating
      it.

## Notes

The rotation command for the image was proved under BUG-339.

## Log

- 2026-09-23T10:50+08:00 — Written as part of the site split, US-342.
- 2026-09-23T11:15+08:00 — Twelve pages, each with a diagram or a table. Every fact was
  checked against the code: button labels, defaults, the `>=` on the
  immediate-email score, the signature header. Two comments that users read
  were wrong and are fixed: `.env.example` said a stranger on an open instance
  polls on the `.env` keys, which US-081 ended, and
  `.env.example.self-hosted` listed ScrapeCreators for Reddit only and
  SocialCrawl for LinkedIn, which is switched off.
- 2026-09-23T11:18+08:00 — Five repository pages open with a pointer to their page on the site,
  and keep their text: code and config name them, and `live-webhook.ts` says
  its receiver is written from `docs/notifications.md`. Removing what the site
  now repeats, and pointing those references at the site, is US-346's. The
  README's *Running it* is a pointer to the guide.
