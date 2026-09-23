---
id: BUG-348
issue: 93
title: The issue sync says an issue is missing when it could not look
type: bug
priority: p3
created: 2026-09-23T12:28+08:00
parent:
area: backlog
labels: [good first issue, easy]
resolution:
---

## Context

`backlog/sync.sh` checks each ticket's issue with `gh issue view`, and hides
the call's error: `2>/dev/null || true`. An empty answer is then reported as
`issue #N named by <file> does not exist`, whatever the cause. On 2026-09-23 a
dry run said #46 did not exist; it exists, is open, and carries US-095's
title. The same call by hand a minute later answered, so the first one had
failed on the network or a rate limit, and the script called that a missing
issue.

A person reading "does not exist" will clear the number or open a second
issue, and the second is the duplicate the script refuses on the next run.
The message must say what the script knows: that it could not look.

## Acceptance

- [ ] An issue GitHub reports as not found still reads "does not exist".
- [ ] Any other failure of the lookup reads "could not check #N for <file>",
      with the first line of `gh`'s own error, and sets the stale flag so
      `--check` still fails.
- [ ] `scripts/backlog-sync.test.mjs` has a case for each, with a stubbed `gh`.

## Notes

`backlog/sync.sh`, the `have=` line after the duplicate check. `gh issue view`
answers a missing issue with "Could not resolve to an issue" on stderr and a
non-zero exit; that text is what separates the two cases.

## Log

- 2026-09-23T12:28+08:00 — Found when a dry run flagged #46, which exists.
