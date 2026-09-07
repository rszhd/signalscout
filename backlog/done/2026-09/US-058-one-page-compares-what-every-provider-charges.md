---
id: US-058
title: One page compares what every provider charges
type: feature
priority: p2
created: 2026-09-07T14:45+08:00
parent:
area:
resolution: shipped
---

## Context

**A person choosing a provider cannot compare the prices this product already
knows.** Nine connectors are shipped and their prices are in four different
units: Bright Data bills a *record*, ScrapeCreators a *request*, SocialCrawl a
*credit*, Apify a *post*. $1.50 per 1,000 records and $8.12 per 1,000 credits
are not two numbers a person can put side by side, and the connections screen
shows neither.

The owner asked for one page, a summary, that makes them comparable.

**A common number is the whole feature, and it needs a second measured fact.**
Cost per unit is useless alone: one SocialCrawl credit buys 45 YouTube results
and 2 LinkedIn posts, so the same credit price is a twentyfold difference in
what a post costs. The missing number is what one unit brings back, and every
connector has it — measured, in a capture, and written today in a code comment
or a ticket log rather than anywhere a screen can read.

So `postsPerUnit` joins `pricePerUnitMicros` on the connector: a fact we
measured, declared beside the price it makes sense of. It is not a promise.
Where a connector has two discovery modes with different yields — ScrapeCreators
Reddit bought 7 posts with a keyword request and 23 with a subreddit one — the
**smaller** number is declared, because over-reporting a bill is the direction
this repository always rounds.

**docs/costs.md governs every figure on this page.** It is an estimate, it says
so, and it is never rounded to cents: ten Reddit records cost $0.015 and a page
showing two cents cannot be reconciled against anything.

**The page also shows what this deployment actually spent**, per platform and
provider, from `api_usage`. That is the one number on the screen that is not a
projection — it is money already gone — and it is the strongest thing a person
can compare two providers on, because it is their own account rather than our
arithmetic.

## Acceptance

- [x] `postsPerUnit` is declared on every shipped connector, with a comment
      naming the measurement it came from, and the registry refuses a value
      that is not a positive number
- [x] One page lists every connector, grouped by platform so a platform's
      providers sit side by side
- [x] Each row shows the price per unit **and** an estimated cost for the same
      quantity of posts, so two providers can be compared directly
- [x] Each row says whether this deployment holds the key, and which provider a
      platform is actually set to use
- [x] Each row shows what this deployment has really spent through that pair,
      from `api_usage`, distinguished from the estimate
- [x] No figure is rounded to cents, and every projected figure is labelled an
      estimate
- [x] The page is reachable from the sidebar and needs no project, like
      Connections — one key, every project
- [x] `pnpm test`, `pnpm lint` and `pnpm typecheck` pass

## Notes

- Read [docs/costs.md](../../docs/costs.md) first. It holds what our estimate is
  wrong about and why it is never rounded.
- Read [docs/design.md](../../docs/design.md) before touching a screen. Tokens
  live in `styles/tokens.css` and shared controls in `styles/theme.css`.
- The yields to declare are all recorded already: Bright Data bills the record
  itself; ScrapeCreators Reddit 7 on a keyword and 23 on a subreddit; SocialCrawl
  X 20 a credit, LinkedIn 10 posts for 5 credits, YouTube 45, TikTok 30,
  Instagram 30; Apify bills the post itself.
- Do not compute a yield from stored posts. Deduplication means stored is not
  collected, and US-014 cost $0.042 to learn that cost comes from units and
  volume comes from posts.

## Log

- 2026-09-07T14:45+08:00 — Written at the owner's request: one page, all
  providers, so the prices can be compared.

- 2026-09-07T15:05+08:00 — Built and closed. 1,252 tests pass, lint and
  typecheck clean, and **a real browser rendered it** — which is not true of
  any other screen in this repository.

  `postsPerUnit` is on all nine connectors, each with the capture it came from.
  The route does one piece of arithmetic and shows its working; the page keeps
  the three kinds of number apart — a declared price, our estimate over it, and
  money already spent.

  **The comparison it exists for, from this instance's own data:** LinkedIn
  through SocialCrawl is $0.2029 for fifty posts and through Apify $0.1000,
  and the spend column says $5.9261 has gone to the first against $0.0520 to
  the second. Reddit shows three providers at $0.0750, $0.0134 and $0.0162.
  Neither is a comparison anybody could make from a connections screen.

  **The browser found a bug the jsdom tests could not.** A six-column table
  inside a flex child defaults to `min-width: auto`, so it refused to shrink
  and pushed the whole page sideways instead of scrolling inside its own card —
  the "Spent so far" column was off-screen on four of the six platforms. jsdom
  computes no layout, so nothing in `Pricing.test.tsx` could have caught it.
  `min-width: 0` on the page and the card fixes it.

  Two smaller things the run corrected. The `tag` classes the page used were
  never defined anywhere, so "In use" and "No key" rendered as bare text. And
  the fixture literal `$0.2030` was wrong: 25 credits at 8,118 micro-dollars is
  202,950, which is **$0.2029**. That figure has been quoted as $0.2030
  throughout this work, including in three ticket logs — the fourth decimal
  place is there precisely so the difference is visible rather than rounded
  away.

  One thing the page reports that looks like a fault and is not: Apify shows
  **No key** on the running instance, because that dev server was started
  before `APIFY_API_TOKEN` was added to `.env`. A restart fixes it, and the
  page is right to say a poll cannot use a provider this process cannot reach.
