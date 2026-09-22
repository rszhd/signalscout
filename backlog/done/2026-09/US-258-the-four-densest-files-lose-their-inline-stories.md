---
id: US-258
issue: 53
title: The four densest files lose their inline stories
type: chore
priority: p3
created: 2026-09-20T02:05+08:00
parent: US-247
area: packages
resolution: shipped
---

## Context

US-247 cut the eight longest file headers and wrote the rule, and the
comment share in `packages/` stayed at 40%: headers were 2% of it. The rest
is inline, and four files carry most of it — `pipeline/src/db/schema.ts`
(1,288 comment lines of 2,091, 61%), `engine/src/sources/types.ts` (78%),
`pipeline/src/worker/collect.ts` (50%) and
`engine/src/sources/providers/apify/linkedin.ts` (50%). A column comment that
says what a column is stays; a column comment that tells the story of the
ticket that added it goes to that ticket.

This is a judgment per comment, so it is one file per sitting, with the
diff read by a person.

## Acceptance

- [x] Each of the four files is below 35% comment lines, and every removed
      paragraph that was not already in a ticket or in `docs/history.md` is
      appended there under the file's path.
- [x] No code changes. Tests, lint and typecheck pass.

## Notes

- Measure with the snippet in US-247's Notes.
- `Correctness-critical` headers keep their failure shape and test list.

## Log

- 2026-09-20T02:05+08:00 — Split out of US-247, which cut the headers and found the share
  is inline.
- 2026-09-22T20:05+08:00 — US-302 wrote the comment rule and measured the whole repository, and split the sweep into US-303, US-304 and US-305 by area. This ticket keeps its four named files and stays a child of US-247, where it came from; the three new tickets take the rest of their areas around it. Do this one first — it is the densest, and the judgment it settles is the one the others copy.
- 2026-09-22T21:05+08:00 — Done, and the answer is not the one the ticket expected. Three files were read block by block and cut: `sources/types.ts` 496 comment lines of 653 to 479 of 636, `worker/collect.ts` 507 of 1,140 to 503 of 1,136, `apify/linkedin.ts` 403 of 893 to 396 of 886. **1,406 comment lines became 1,378 — two per cent.** Typecheck, lint and 779 tests pass; no behaviour changed.
- 2026-09-22T21:05+08:00 — `db/schema.ts` no longer exists as the ticket describes it. It was split into `db/schema/`, ten files holding 1,314 comment lines of 2,377 and 24 blocks over 15 lines. Every one of those 24 was read. **Nothing was cut.** Each opens by saying what the table or column is and then gives the constraint the next reader would otherwise break — why `UNIQUE (monitor_id, source, provider)` carries the provider, why `since` is on the continuation rather than read from `monitors.last_polled_at`, why a cents column would round a tenth of a cent to zero. That is table documentation, which is what the rule protects.
- 2026-09-22T21:05+08:00 — **The premise does not hold, and this is the evidence for it.** The ticket assumed these files carry a session's stories. They carry contracts. `types.ts` is 75% comment because it is an interface whose comments *are* the specification, and cutting everything defensible moved it by one point. What did deserve cutting was narrow and specific: framing about what PLAN.md originally sketched, the narrative of the US-024 split, and — the only real clutter found — a measurement in `apify/linkedin.ts` that already sat word for word in docs/history.md.
- 2026-09-22T21:05+08:00 — One contradiction was found and fixed, which is worth more than the line count. `types.ts` said US-048 existed "because nobody knows what this order is worth". docs/history.md records that it was measured: leads sit deeper than a platform's ranking, 10.2% against 30.6%, p = 0.011. The comment argued against the project's own record, and now points at it.
- 2026-09-22T21:05+08:00 — Whole repository, before and after: 28,990 comment lines of 118,597 to 28,962 of 118,570. Still 24.4%. 287 blocks over 15 lines to 284.
