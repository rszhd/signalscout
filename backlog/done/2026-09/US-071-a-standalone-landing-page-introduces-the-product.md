---
id: US-071
title: A standalone landing page introduces the product
type: feature
priority: p2
created: 2026-09-08T15:04+08:00
area: landing
resolution: shipped
---

## Context

The owner requested an Astro landing page in `landing/`, deployed independently
on Vercel. The marketing site explains the product and links to self-hosting.
The application keeps its existing build and deployment.

## Acceptance

- [x] `landing/` installs and builds without application packages or secrets.
- [x] The page describes shipped capabilities and labels sample conversations.
- [x] Navigation, example selection and FAQ disclosures work in a browser.
- [x] Desktop and 320px layouts have no horizontal page overflow.
- [x] Astro type checking and the production build pass.
- [x] Vercel root directory and build instructions are documented.

## Notes

Use the application palette and Figtree, with local copies for an independent
build. The owner added Cloud pricing as a follow-up: $15 USD per month, presented as
available at launch. Provider usage remains separate. Billing implementation
and Vercel deployment are outside this task.

## Log

- 2026-09-08T15:04+08:00 — Owner approved adding a ticket. Implementation started.

- 2026-09-08T15:14+08:00 — Completed the page and deployment documentation.
  `npm ci`, `npm run check` and `npm run build` pass in `landing/`. Biome
  reports no issues for the new CSS and configuration. Chrome verified 1440,
  1024, 768, 390 and 320px layouts without page overflow. Example selection,
  keyboard FAQ disclosure, section targets and local assets pass. Axe reports
  no WCAG A/AA violations at 1440 and 320px. Reviewed desktop and phone
  screenshots. Vercel deployment remains unperformed.

- 2026-09-08T15:18+08:00 — Owner requested hosted pricing and set it to $15
  per month. Added Self-hosted and Cloud plan cards, pricing navigation and
  updated FAQs. Cloud signup reads `PUBLIC_APP_URL`; the owner has not yet
  supplied its destination. The page remains on pricing until configured.
  Astro check and build pass. Chrome verified five widths from 320 to 1440px;
  axe found no WCAG A/AA violations at desktop and phone widths. Both plan
  prices were read from the rendered page. Biome and whitespace checks pass.
