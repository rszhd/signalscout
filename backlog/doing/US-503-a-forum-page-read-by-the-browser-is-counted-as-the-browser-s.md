---
id: US-503
title: A forum page read by the browser is counted as the browser's, not Bright Data's
type: feature
priority: p1
created: 2026-11-03T00:18+08:00
parent: US-471
area: engine
resolution:
---

## Context

The forum connector records every page under the provider `brightdata`
and prices it at Bright Data's rate, a browser page included: one unit a
page and one more a browser started (US-471's decision, because Browser
Use's own cost settles minutes after a browser stops). On 2026-11-03 the
owner asked whether BuyerFinder used Bright Data or Browser Use. Its
`api_usage` said Bright Data for 55 units, $0.083; every page had come
through Browser Use, and Browser Use's own records showed the real cost was
lower. The owner: "why this confusion happen again and again, make sure
this doesnt happen again and i wanna know the cost".

The split the owner agreed:

- **Bright Data units are Bright Data's pages only.** A page the browser
  read counts no unit in the usage row, so `api_usage` names only what
  Bright Data billed.
- **The browser is told to the application.** Each browser, when it stops,
  is reported through `onBrowser`: its id, when it started and stopped,
  pages, and the monitor that asked. The application reads the settled cost
  from Browser Use and keeps it (BuyerFinder: US-504). The engine stays
  stateless; it cannot wait for a cost that settles minutes later.
- **The monitor rides on the request.** `SearchRequest` and
  `CompleteRequest` take an optional `monitorId`, which the pipeline
  fills and a connector never sends to a provider.
- **Browser Use's own proxy is off.** Four production browsers on
  2026-11-02 (the polls at 04:00 and 16:00 UTC) were billed at $5 a GB,
  Browser Use's own proxy rate, although every start sends our
  `customProxy`. A probe on 2026-11-03 found that a dead proxy port does
  not cause it. The cause is unknown; `proxyCountryCode: null` beside the
  custom proxy turns Browser Use's own proxy off, so it cannot be used.

## Acceptance

- [x] A forum page read through the browser adds no unit to the connector's result; a Bright Data page adds one.
- [x] Each browser is reported once when it stops, with its id, start, stop, pages and the request's monitor.
- [x] The pipeline puts the monitor's id on every search and complete request.
- [x] A browser starts with `proxyCountryCode: null` beside `customProxy`.
- [x] Tests replay captured pages through the fake browser; no test opens one.

## Notes

Only BuyerFinder passes browser credentials today. An application that
passes them now counts the browser's cost itself, from `onBrowser`.

## Log

- 2026-11-03T00:18+08:00 — Probe, 3 browsers, $0.0014 (balance $0.3324 to $0.3310). Our DataImpulse proxy with `proxyCountryCode: null`: accepted, mode "custom", digitalpoint's home page read, billed $0.20 a GB (1.99 MB, $0.00039). A dead proxy port, with and without `proxyCountryCode: null`: the page fails, no proxy charge, no switch to Browser Use's proxy. Browser Use's list on 2026-11-02 UTC: 16 browsers, browser $0.0057, proxy $0.0150, 20.0 MB; the 12 forum-check browsers at $0.20 a GB, the 4 poll browsers at $5.00 a GB.
- 2026-11-03T00:23+08:00 — Built. Bright Data units are its pages only; a browser page counts none. Each browser is reported once when it stops (`onBrowser`: id, start, stop, pages, monitor); a handler that throws is logged. `SearchRequest` and `CompleteRequest` take `monitorId`, which the collect and complete steps fill. A browser starts with `proxyCountryCode: null`. The cap a query poll may bill drops to one unit a page. `pnpm test` 2,802 pass before the two new assertions; the changed files pass after; lint and typecheck pass. Not yet run live: BuyerFinder (US-504) is the first user.
