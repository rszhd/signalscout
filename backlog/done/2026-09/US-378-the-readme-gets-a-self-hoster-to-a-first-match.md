---
id: US-378
title: The README gets a self-hoster to a first match
type: feature
priority: p1
created: 2026-09-23T16:57+08:00
parent:
area: docs
resolution: shipped
---

## Context

The README was 292 lines, and a person who came to run SignalScout read most
of them before the app did anything. Its install ended at `docker compose up`,
where the app starts but finds nothing: a provider key and a model key are
also needed, and the README first said so eighty lines further down, in
another section. The rest was for other readers — the provider agreements,
every connector's price, the roadmap with ticket ids, a table of 25
repository documents, the license argument — and the seventh-network rule
was said three times.

The site now holds the full walk (US-343) and the full install (US-344), so
the README can be the short path into them.

## Acceptance

- [x] The install says what a machine needs, then the five commands, then the
      two keys, then the first monitor — in that order.
- [x] The two warnings before a public address are near the install: the
      database password and HTTPS.
- [x] Provider agreements, connector prices, the roadmap and the license
      argument are one line and a link each, or gone.
- [x] The repository table lives in CONTRIBUTING.md, not in the README.
- [x] The seventh-network rule is left to PLAN.md, not said three times.
- [x] `#running-it` and *What this is not* still exist: the site and the
      feature form link to them.

## Notes

The cloud promise keeps its words, because US-321 quotes them.

## Log

- 2026-09-23T16:57+08:00 — Written on the owner's request: the README is too
  much for somebody who only wants to self-host. The owner dropped the
  provider-agreement section from the README altogether; the keys page keeps
  it.
- 2026-09-23T16:59+08:00 — README from 292 lines to 128. The install ends at the first monitor;
  the app asks for both keys after the first account (`Onboarding.tsx`), so
  step 2 says so. The repository table moved to `docs/map.md`. Every local
  link resolves.
- 2026-09-23T18:18+08:00 — The owner read the README and accepted it.
- 2026-09-23T20:12+08:00 — The table moved again, to CONTRIBUTING.md: in `docs/map.md` it
  broke the 800-word limit `docs-map.test.ts` holds, which the release pull
  request (#95) caught.
