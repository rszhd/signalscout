---
id: US-345
title: A cloud customer finds what differs from the self-hosted build
type: feature
priority: p2
created: 2026-09-23T10:50+08:00
parent: US-342
area: docs
resolution:
---

## Context

The cloud includes the provider and model keys, sells plans with an
allowance, and has no Connections or Models screen. A cloud customer reading
a page written for a self-hoster would look for a key they must not need.

This repository charges nobody and the landing page owns the prices, so the
cloud section says what differs and links to the pricing page. It holds no
price and no plan limit.

## Acceptance

- [x] A *Cloud* section: what is included, what the allowance means, the
      trial, billing and cancelling, and what a cloud account cannot do.
- [x] No price, credit count or plan limit is written on the site.
- [x] Every shared page that differs on the cloud links here.
- [ ] The hosted repository's owner has read the section before it is
      published.

## Notes

The hosted repository's `docs/billing.md` is the source for the rules, not
for the numbers.

## Log

- 2026-09-23T10:50+08:00 — Written as part of the site split, US-342.
- 2026-09-23T11:26+08:00 — Two pages, *How the cloud differs* and *Plans and billing*, written
  from the hosted repository's `docs/billing.md` and its Billing and Login
  screens, with the rules and none of the numbers. Four shared pages carry a
  one-box note where the cloud differs. Waiting for the owner to read it.
