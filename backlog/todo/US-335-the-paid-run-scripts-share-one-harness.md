---
id: US-335
title: The paid-run scripts share one harness
type: chore
priority: p3
created: 2026-09-23T06:46+08:00
parent:
area: tooling
resolution:
---

## Context

The `live-*` and `measure-*` scripts in `packages/pipeline/src` are 12
files and 4,740 lines. Most are one script copied per platform:
`live-tiktok-poll.ts` and `live-youtube-poll.ts` differ in 26 of about 218
code lines. Each copy sets up a database, a worker with some queues run
inline, and its own confirmation before it spends.

These scripts spend real money. A safety check fixed in one copy is missing
from the others until somebody remembers them all.

## Acceptance

- [ ] One harness holds the setup every script repeats: the database, the
      inline queues, the confirmation before spending, and the cost report.
- [ ] Each script keeps only what is its own: the platform, the queries and
      what it prints.
- [ ] Each command in `docs/instruments.md` still runs, and the Log records
      one `--dry` run per script.
- [ ] The scripts live where US-326 decides, outside the published package.

## Notes

- Do this with or after US-326, which moves the scripts out of the npm
  package; both touch the same files.
- A `--dry` run spends nothing; a real run does, and `docs/instruments.md`
  says how much.

## Log

- 2026-09-23T06:46+08:00 — Found in a review of the open repository.
