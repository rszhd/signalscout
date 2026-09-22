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
decision that would be made twice. A measurement goes to docs/history.md. A
story about how the code came to be goes to its ticket's Log. A ticket id may
stay when it is the only pointer to a decision.

**Keep the traps.** A docblock that explains a wire format, a provider's
undocumented behaviour or a money rule is exactly what the rule protects. Cut
the story around it.

**Four files are US-258's**, not this ticket's: `packages/pipeline/src/db/schema.ts` and
`packages/pipeline/src/worker/collect.ts` belong to US-258. Do US-258
first and leave those alone here.

## Acceptance

- [ ] `node scripts/comment-density.mjs --blocks --min=15` is run first, and
      every block it names under `packages/pipeline` outside tests is read.
- [ ] Each is cut to the rule, or kept with a reason in this ticket's Log.
- [ ] Measurements that were cut are in docs/history.md under the ticket that
      made them, not deleted.
- [ ] No behaviour changes. The diff is comments and history.md, and the test
      suite is the proof.
- [ ] The script is re-run and the new numbers for this area are in the Log
      beside the old ones.

## Notes

- Several commits, one per folder, so a reviewer can read one.
- The baseline is in US-302's Log and in `--json` form from the script.

## Log

- 2026-09-22T20:05+08:00 — Split from US-302, which holds the rule and the measurement.
