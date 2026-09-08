---
id: US-076
title: The address bar says one thing
type: feature
priority: p2
created: 2026-09-08T20:10+08:00
parent:
area: web
resolution:
---

## Context

**One address said the same thing twice.** Stripe returned a person to
`/billing?checkout=done#/billing`. The path was the server's answer and the
hash was the application's, because the router lived in the hash while Fastify
answered on the path. The owner read that address and asked for it to be one
address.

**The hash was a decision, and its reason had expired.** `App.tsx` said a path
router "would also need history handling this app has no use for yet, and a
hash is one listener". Two things changed since. `react-router` is already a
dependency of `apps/web`, so the router is not a new package. And Fastify's
not-found handler already serves `index.html` for any path that is not an API
route or a file, which is the whole of the server half — Vite's dev server does
the same.

**The project was a query parameter over a page, and it is a path segment
now.** An inbox is a question about one business, so the address is *of* that
business: `/projects/<id>`, `/projects/<id>/monitors`,
`/projects/<id>/monitors/new`. `?project=` described a filter laid over a page
that meant something without it, which is the opposite of what US-045 decided.
Three screens read that parameter out of the hash and refreshed themselves on
`hashchange`, because moving between projects remounted nothing; a route
parameter removes both the reading and the listener.

**The guard survives the move, and it is what the routes are for.** US-045's
rule is that no project means no inbox. It lived in an effect that corrected
the hash after rendering. It is now the route table itself: an address naming
no project matches no project-scoped route, and the catch-all sends it to
choose one. A bookmark, a typed address and a link somebody forgot to update
all arrive at the same place.

## Acceptance

- [x] Every screen has a path address, and no address in the application
      contains a `#`
- [x] The project is a path segment, and the inbox, the monitor list and the
      monitor form take it as a prop rather than reading the address themselves
- [x] An address naming no project lands on the projects list, and the address
      is corrected rather than left saying something untrue
- [x] Stripe returns to `/billing?checkout=done`, the page says what happened,
      and the parameter is removed so a reload does not repeat it
- [x] The billing route is registered only where the instance charges
- [x] Every link is a `Link`, so a click routes rather than reloading the app
- [x] The test harness mounts every screen inside a router, and a case asserts
      where the application went rather than what the browser did
- [x] The whole suite passes, and the only expected values that moved are
      addresses

## Notes

- `route.ts` holds the whole table: `routes` are the patterns the router
  matches and `paths` are the builders every screen uses. One file, so the
  shape of an address is written once.
- Every id is encoded into its segment. A slash inside one would silently
  become a different route.
- The jsdom harness uses `MemoryRouter`. A test asserts where the application
  went, and a memory history says so without a `window.history` every test file
  would then have to reset.
- What is still unproven is the same thing US-017 records: no real browser has
  rendered any of this. A refresh on a deep path is served by Fastify's
  not-found handler, which no test exercises through a browser.

## Log

- 2026-09-08T20:10+08:00 — Written after the owner read
  `/billing?checkout=done#/billing` and asked for the routing to be fixed.
