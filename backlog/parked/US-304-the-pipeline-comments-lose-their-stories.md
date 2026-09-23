---
id: US-304
issue: 59
title: The pipeline comments lose their stories
type: chore
priority: p3
created: 2026-09-22T20:05+08:00
parent: US-302
area: pipeline
resolution:
---

## Context

US-302 wrote the rule and measured the repository: 28,990 comment lines of
118,597 (24.4%), 1,722 naming a ticket, and 287 blocks over 15 lines. The
sweep is a judgment per block, so it was split by area rather than done in
one sitting.

**This ticket is `packages/pipeline`: 98 blocks over 15 lines, outside tests.**
The tables, the worker and the queues. `worker/collect.ts` is the densest file in the repository at 507 comment lines.

The rule is in AGENTS.md: a comment says the constraint, the trap, or the
decision that would be made twice. A measurement stays in its ticket's Log,
and so does a story about how the code came to be. A ticket id may
stay when it is the only pointer to a decision.

**Keep the traps.** A docblock that explains a wire format, a provider's
undocumented behaviour or a money rule is exactly what the rule protects. Cut
the story around it.

**Four files are US-258's**, not this ticket's: `packages/pipeline/src/db/schema.ts` and
`packages/pipeline/src/worker/collect.ts` belong to US-258. Do US-258
first and leave those alone here.

**Parked on 2026-09-22, the day it was written**, because US-258 tested the
premise on four files of three different kinds and it did not hold. Read its
Log before restarting this. The short version: these comments are contracts,
not stories, and reading every long block bought two per cent.

**What would make this worth doing** is a narrower rule than "read every
block": a measurement in the code that already sits in a ticket's Log is a
duplicate, and cutting it costs nothing and removes a second copy that can
drift. `apify/linkedin.ts` held one. Nobody has counted how many more there
are, and counting them is a smaller ticket than this one.

## Acceptance

- [ ] `node scripts/comment-density.mjs --blocks --min=15` is run first, and
      every block it names under `packages/pipeline` outside tests is read.
- [ ] Each is cut to the rule, or kept with a reason in this ticket's Log.
- [ ] Measurements that were cut are in the Log of the ticket that made them,
      not deleted.
- [ ] No behaviour changes. The diff is comments and ticket Logs, and the test
      suite is the proof.
- [ ] The script is re-run and the new numbers for this area are in the Log
      beside the old ones.

## Notes

- Several commits, one per folder, so a reviewer can read one.
- The baseline is in US-302's Log and in `--json` form from the script.

## Log

- 2026-09-22T20:05+08:00 — Split from US-302, which holds the rule and the measurement.
- 2026-09-22T21:10+08:00 — Parked the day it was written. US-258 swept four files first and found contracts rather than stories: 1,406 comment lines became 1,378, and the ten schema files gave up nothing at all. Grinding this area's blocks for the same return is not worth a session. What is worth doing is the narrower thing in the Context above.
- 2026-09-23T05:30+08:00 — US-312 retired docs/history.md. A measurement cut from a comment now goes to the Log of the ticket that made it; the Context and Acceptance above say so.
