---
id: US-344
title: A self-hoster installs and runs SignalScout from the docs
type: feature
priority: p1
created: 2026-09-23T10:50+08:00
parent: US-342
area: docs
resolution:
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

- [ ] *Self-hosting*: install, TLS and the proxy, providers and keys, models,
      email, webhooks, backups, upgrading, key rotation, troubleshooting.
- [ ] A configuration reference built from `.env.example` at build time.
- [ ] The webhook contract is one page a receiver can be written from.
- [ ] Each repository page that lost its self-hoster half opens with one line
      pointing at the site, and keeps what a contributor needs.
- [ ] The README's install section links to the site rather than repeating
      it.

## Notes

The rotation command for the image was proved under BUG-339.

## Log

- 2026-09-23T10:50+08:00 — Written as part of the site split, US-342.
