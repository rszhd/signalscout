---
id: US-423
title: A monitor is told what each platform returns
type: feature
priority: p2
created: 2026-09-26T02:07+08:00
parent: US-036
area: web
resolution:
---

## Context

**Radar measured the platforms side by side, and they are not close.**
Requests per dollar, asked the right way for each (signalscout-radar US-413,
US-417):

| Platform | Cost per real request |
|---|---|
| Reddit, the right subreddit | about $0.0007 |
| Reddit or X, keyword search | about $0.003 |
| YouTube, comments under review videos | about $0.015 |
| LinkedIn | about $0.09 (1 in 200 posts) |
| TikTok comments | none; viewers name the item on screen |
| Instagram | not measured: the connector dropped every comment (BUG-426); a comment costs about $0.0027 at SocialCrawl |

**A person picking platforms for a monitor sees none of this.** Each box costs
the same to tick, and a monitor on TikTok or LinkedIn pays for posts that
almost never match.

## Acceptance

- [ ] The platform choice says, per platform, what it tends to return, in one
      line, from measured numbers with their date
- [ ] Reddit and X are the default for a new monitor
- [ ] The numbers live in one place both applications read (`packages/ui`
      labels or the engine's platform descriptors)

## Notes

- Radar's figures are for product requests in general; a monitor's own
  numbers (US-419, US-420) replace them once it has run.
- US-036 rates providers; this rates platforms.

## Log
