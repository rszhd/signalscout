---
id: US-098
title: A provider card links to its website
type: feature
priority: p2
created: 2026-09-10T01:40+08:00
resolution: shipped
---

## Context

During onboarding, a person needs a fast way to visit the provider site and
finish a purchase or signup. The screen already names the provider. It should
also point to the provider's own website.

## Acceptance

- The onboarding provider step shows a link to the selected provider's website.
- The link uses provider data, not a hardcoded URL in the screen.
- The link opens the provider website in a new tab or window.
- The link is present for every provider the onboarding screen can offer.
- The rest of the onboarding flow still works after the link is added.

## Notes

- `apps/web/src/Onboarding.tsx`
- `apps/web/src/Onboarding.test.tsx`
- `packages/core/src/sources/types.ts`
- Provider descriptors under `packages/core/src/sources/providers/*`

## Log

- 2026-09-10T01:40+08:00 — Added the ticket for onboarding provider website links.
- 2026-09-10T01:41+08:00 — Linked provider data into onboarding and shared the website URL from the API.
