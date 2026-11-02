---
id: US-509
title: A site that refuses a plain request is reported as blocked
type: feature
priority: p2
created: 2026-11-03T03:29+08:00
parent: US-050
area: pipeline
resolution: shipped in 0.24.1
---

## Context

Many sites sit behind Cloudflare or another bot protection. A plain
request to such a site gets a 403, or a challenge page answered as a 200.
`fetchDocument` reported the first as a status like a 404, and handed the
second back as the page's text, so a model described a bot check.

An application with a real browser can read such a page, but only if it can
tell a refusal from a missing page. So `fetchDocument` now names it:

- A 403, 429 or 503 is a `blocked` failure. Its message is unchanged.
- A challenge page answered as a 200 is a `blocked` failure, not text.
- The engine exports `openBrowserUse`, the cloud browser the forum
  connector uses, and `challengeIn`, the challenge check.

Cloudflare's "Enable JavaScript and cookies to continue" page came titled
"Challenge - <site>", with its words after a long script, and the check by
title missed it. The phrase is now looked for in the first 20,000
characters.

## Acceptance

- [x] A 403, 429 or 503 is a `blocked` failure.
- [x] A challenge page answered as a 200 is a `blocked` failure.
- [x] `openBrowserUse` and `challengeIn` are exported.
- [x] A real browser waits on Cloudflare's "Enable JavaScript and cookies"
      page and reads the site behind it.

## Notes

- `packages/pipeline/src/projects/document.ts`,
  `packages/engine/src/sources/providers/brightdata/unlocker.ts`.

## Log
- 2026-11-03T03:29+08:00 — Written after the change, on the owner's word.
  Plain reads on 2026-11-03: 7 of 10 well-known sites answered 403. Read
  through Browser Use on our own proxy: producthunt.com and upwork.com
  read whole, upwork.com after the browser waited out the challenge;
  g2.com gave only its name. 6 browsers cost $0.0046 on the Browser Use
  balance.
