---
id: US-113
title: The landing page reports its visitors
type: feature
priority: p2
created: 2026-09-10T22:00+08:00
completed: 2026-09-10T22:20+08:00
area: landing
resolution: shipped
---

## Context

The landing page has never measured anything. It is the product's public face
and the only page a stranger meets before signing up, and nobody can say how
many strangers meet it, where they arrive from, or whether the pricing section
is ever reached. Every decision about the page so far — the copy, the phone
layout in US-112, the social card in US-111 — has been made from measurement of
the *page* and none at all of its *readers*.

Google Analytics 4 is the choice, on the owner's word.

**The measurement id is a build-time variable and not a literal**, which is
`PUBLIC_APP_URL`'s own shape and reason. This repository is public. An id
written into `index.astro` is an id every fork inherits, so somebody else's
visitors land in this property and the numbers stop meaning anything. It also
means a `npm run dev` and a Vercel preview deployment report nothing, which is
right: a preview is one person looking at their own work.

Where the variable is unset the page carries **no tag at all**, rather than a
tag with an empty id. An empty `id=` is still a request to another origin, still
a connection a visitor pays for, and it reports nothing in exchange.

## Acceptance

- [x] `PUBLIC_GA_MEASUREMENT_ID` is read at build time and nothing else in the
      repository holds a measurement id.
- [x] With the variable unset, the built page contains no reference to
      `googletagmanager.com`, no `dataLayer` and no `gtag`.
- [x] With the variable set, the loader and the snippet are both in `<head>`,
      the loader keeps `async`, and the id in the URL is the one supplied.
- [x] `gtag` is reachable as `window.gtag` after the snippet runs.
- [x] A real browser loading the built page requests the loader and sends a
      collect hit.
- [x] The README no longer claims the page collects no visitor data, and says
      where the id is set and that a change needs a redeploy.
- [x] `npm run check` and `npm run build` pass.

## Notes

- The landing folder is outside the pnpm workspace, so it has no test file.
  The evidence here is a build of each branch and a browser, not a suite.
- **`define:vars` wraps an inline script in a function.** Google's published
  snippet declares `gtag` at the top level, which inside that wrapper is local
  to it. The pageview arrives anyway, because the library reads `dataLayer`
  rather than the function — so this is invisible until somebody writes
  `gtag("event", ...)` and finds nothing. `window.gtag` is the assignment.
- **No consent banner.** GA4 sets cookies and this page will not ask. That is
  a decision to make before the site is advertised into the EU or the UK, and
  it is a ticket rather than a setting.
- **No event beyond the pageview.** The page can say who arrived and nothing
  about what they pressed. Scroll depth to the pricing section, and the two
  actions in the hero, are the obvious next ones and are not in this ticket.
- The application at `app.signalscout.run` is untouched. It is behind a login
  and measuring a signed-in inbox is a different question with a different
  answer.

## Log

- 2026-09-10T22:10+08:00 — Added the constant and the two-script block, both
  `is:inline` and both inside `{analyticsId && …}`. Check passes. Built each
  branch: unset gives zero matches for the tag in `dist/index.html`, set gives
  the loader with the supplied id inside `<head>`.
- 2026-09-10T22:15+08:00 — **The explanation shipped when the tag did not.**
  The block was documented in an HTML comment, which Astro renders, so the
  untagged page carried two lines naming `googletagmanager` and `dataLayer` —
  the page telling a source-reader about a tag it does not have. It is a
  template comment now, stripped from the output. That is a departure from the
  file's other comments, which explain markup that is on the page; this one
  explains markup that usually is not.
- 2026-09-10T22:20+08:00 — **Both branches driven in real Chrome**, over the
  DevTools protocol against `astro preview`, recording every request.

  Tagged: **15 requests**, two of them analytics — the loader
  `gtag/js?id=G-TESTONLY01` and a `google-analytics.com/g/collect` hit carrying
  the same `tid`. `typeof window.gtag` is `"function"` and `dataLayer` holds 4
  entries. Untagged: **13 requests and no analytics request at all**, `gtag`
  undefined, `dataLayer` empty.

  The id used was `G-TESTONLY01`, which is not a real property, so the hit was
  sent and landed nowhere. What this proves is our half: the loader is fetched,
  it runs, and it sends. **That a real property receives it is unproven until
  the variable is set in Vercel and the page is redeployed** — GA's realtime
  report is what closes it.
- 2026-09-10T22:45+08:00 — **Live.** `PUBLIC_GA_MEASUREMENT_ID` was set on the
  `signalscout-landing` Vercel project, **Production only**, and the folder was
  deployed with `vercel --prod`. A preview deployment and a local run still
  report nothing, which is the point of scoping it to one environment.

  `https://www.signalscout.run/` serves the loader carrying the real property
  id, and so does the apex through its redirect. Headless Chrome against the
  live site: **15 requests**, the loader and a `google-analytics.com/g/collect`
  hit carrying the same `tid`, `window.gtag` a function, `dataLayer` with 4
  entries.

  **The project is not connected to git**, so a push to `dev` deploys nothing
  here. `vercel --prod` from `landing/` is the only path, and the same is true
  of any later change to this page.

  What is left open is the property's own side: GA's Realtime report is what
  says the hit was accepted and attributed, and nobody has read it.
