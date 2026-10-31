---
id: US-471
title: A forum page Bright Data cannot pass is read through a cloud browser
type: feature
priority: p2
created: 2026-10-31T09:06+08:00
parent: US-470
area: sources
resolution:
---

## Context

US-470 reads forum sections through Bright Data's Web Unlocker. A survey of
287 niche forums (US-466 in BuyerFinder's repository) found 44 where the
unlocker returns the bot check itself, mostly VerticalScope's proof-of-work
page: WatchUSeek, Mothering, Contractor Talk, HVAC-Talk, The Gear Page and
most woodworking, dog, motorcycle and guitar forums. Bright Data also refuses
a few sites without KYC.

**Browser Use's cloud browser opened all 44.** A real browser runs the check's
script and the page loads. Our parsers read the result: 37 XenForo 2, one
Discourse, and two that read from a section page.

**The owner chose the cloud browser with a cheap residential proxy, never a
browser we run ourselves.** Browser Use takes a proxy of ours
(`customProxy`) at $0.20 a GB, against $5 a GB for its own. With Evomi's
residential proxy the 44 cost about $0.001 a page, below Bright Data's
$0.0015. With Browser Use's own proxy they cost about $0.0106 a page.

**So the fallback is automatic, and only with our own proxy.** Close prices
allow an automatic fallback; a large gap needs a switch the owner flips. With
the proxy the fallback is cheaper than the primary. Without it, it is seven
times dearer, so it does not run.

**The order stays: Bright Data first.** Bright Data's 5,000 free requests a
month cover the first subscriber, and Browser Use with Evomi is untested on
the 243 forums Bright Data reads.

## Acceptance

- [x] The application hands the forum connector Browser Use's key and a
      proxy's host, port, user and password. Browser Use is not a provider in
      the registry, so nothing is stored and no screen changes.
- [x] The forum connector takes a second page fetcher. When Bright Data
      answers with a bot check or a refusal, the same address goes to the
      browser; any other answer does not.
- [x] An application may send a forum, by host, straight to the browser.
- [x] Without a proxy, the browser is never used, and a log line says why.
- [x] One browser reads every page of one call, and is stopped at the end of
      the call, on an error too. A browser left running bills by the minute.
- [x] A proxy connection error is retried once, in a new browser with a new
      session id.
- [x] A page still showing a bot check after 25 seconds is skipped with a log
      line, as Bright Data's refusal is.
- [x] A browser page counts one Bright Data unit, and each browser started
      one more, so the cost cap counts it before the call. A failure of the
      browser skips the page and never stops the poll.
- [x] Every page fetched is told to the application: host, section or
      thread, fetcher, outcome, program and units.
- [x] A site's `alert()` cannot end a read.
- [x] Tests replay captured pages through a fake browser; no test opens one.
- [ ] One live poll of three bot-check sections, measured: pages, bytes on
      the proxy's own count, Browser Use's cost, and the balance before and
      after.

## Notes

**Measured 2026-10-31**, on the 44 home pages, four browsers of about ten
pages each:

| | Pass | Cost a page |
|---|---|---|
| Browser Use, its own proxy | 44 of 44 | about $0.0106 |
| Browser Use + Evomi Core residential | 42 of 44 | about $0.001 |
| Bright Data Web Unlocker | 0 of 44 | $0.0015 list price |

The two Evomi failures were proxy connection errors, not bot checks. Evomi
counted 21.98 MB for 47 pages. Browser Use counted 106.6 MB for the same
traffic, at $0.20 a GB, and $0.0245 in all, which the balance confirmed.

**A browser's first page costs most.** It loads the check's scripts; the
pages after it reuse the cache. A browser per call keeps the cost near the
figure above only if a call reads several pages, so the live poll measures it.

**Browser Use's figures settle late.** A browser's `proxyCost` read 15
seconds after it stopped was a fifth of the balance's fall. Read the
balance before and after a paid run.

**API, version 4.** `POST /api/v4/browsers` with `customProxy` returns an id
and a `cdpUrl`; `PATCH /api/v4/browsers/{id}` with `{"action": "stop"}` stops
it; `GET /api/v4/browsers/{id}` holds `browserCost`, `proxyCost` and
`proxyUsedMb`. The key goes in `X-Browser-Use-API-Key`. Closing the CDP
connection does not stop a browser.

**Evomi's session lives in its password**: `<password>_country-US_session-<id>`
keeps one address for 30 minutes, so each browser gets its own id.

**Open: the CDP client.** The probe drove the browser with `playwright-core`.
The engine has no such dependency yet; a smaller CDP client may do.

**The hosted application gets the provider too** on the next package
version; nothing there sets its key.

## Log
- 2026-10-31T09:18+08:00 — Built. Two changes from the ticket as written. Browser Use is not a
  registry provider: a provider is stored per account and shown on the
  connections screen, and the only user is an application that holds the
  key itself, as BuyerFinder holds SocialCrawl's for its Reddit fallback.
  And a browser page is counted in Bright Data units, one a page and one a
  browser started, not at Browser Use's own figure, which settles minutes
  after the browser stops. The measured cost, $0.001 a page, is below one
  unit. The browser is driven over the DevTools protocol through Node's own
  WebSocket, so the engine takes no browser library. PowerForum's "One
  moment, please" page now counts as a bot check. 2,690 tests; root lint and
  type check pass. The live poll is next.
