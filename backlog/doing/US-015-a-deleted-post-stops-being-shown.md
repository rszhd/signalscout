---
id: US-015
title: A deleted post stops being shown
type: feature
priority: p2
created: 2026-09-04T22:49+08:00
parent:
area:
resolution:
---

## Context

Reddit's terms require that content the author removed stops being shown.
Storing a permanent copy of every post and serving it forever breaks that,
and it breaks it for every self-hoster at once, using credentials they
registered in their own name.

This is a correctness and compliance concern, not a feature. It is written
early because the column it needs is cheap now and expensive later: adding
`last_verified_at` to a table full of matches means backfilling a null and
deciding what a null means.

The design is a reconciliation job. It re-checks matched posts on a schedule,
oldest verification first, and hides the ones that are gone or deleted. Hidden
rather than deleted, because the score, the reason and the user's feedback are
our own records and remain useful.

Cost is the constraint. This ticket originally assumed Reddit re-checks were
free. US-024 split providers, and the live probes below disproved that
assumption. Re-checks use the selected connector and its reported units. The
job checks recent and unread matches often, older ones rarely, and on a metered
source it
draws from the same budget as everything else — a re-check that pushes a
monitor past its cap must lose to the poll.

## Acceptance

- [x] `last_verified_at` is set whenever a match is checked
- [x] A scheduled job re-checks matches, oldest verification first
- [ ] A post that is gone, deleted or removed is hidden from the inbox
- [x] A hidden match keeps its score, its reason and its feedback
- [x] Only an id and an excerpt were ever stored, so hiding removes what is
      shown rather than what was retained
- [x] Re-check frequency differs by match age and by whether it was read
- [x] On a metered source, re-checks consume budget and are refused when the
      cap is reached
- [x] A source outage does not hide matches; only a definite deletion does

## Notes

- Depends on [US-005](US-005-reddit-returns-candidate-posts.md) and
  [US-011](US-011-the-inbox-shows-why-a-post-matched.md).
- STACK.md, *Honor deletions*.
- Failing open is the rule. An unreachable API is not a deletion, and treating
  it as one empties a user's inbox during an outage.

## Log

- 2026-09-04T22:49+08:00 — Written from STACK.md.

- 2026-09-05T19:55+08:00 — Implemented the scheduled reconciliation job and
  migration 0019. A global stately queue checks at most twenty posts per job,
  oldest verification first. Recent unread/read matches wait one/three days;
  old unread/read matches wait seven/thirty days. Paused monitors keep their
  inbox checks. Metered checks obey the existing budget and yield to due or
  active polls. Each reported charge is recorded before another check starts.

  One shared post is checked once. Its result updates every match. Pending
  checks retain their provider, cursor and paying monitor across restarts and
  provider switches. A deletion sets a post tombstone and hides its matches.
  A database trigger prevents late classifications from resurrecting it.
  The classifier skips known tombstones. Feedback exports retain the verdict
  and score but omit the removed title. Inbox and notification queries already
  excluded hidden matches. The collector still keeps at most 2,000 body
  characters plus identity and display metadata; verification copies no body.

  Assertions were written before the reconciliation implementation, provider
  verification methods, tombstone trigger, classifier exclusion, active-poll
  guard and export change. The production scheduler was driven through real
  pg-boss and Postgres with an injected deletion response. No suite call spent
  money. The added queue is the only changed existing expected queue list.

- 2026-09-05T19:55+08:00 — Live captures answered the provider questions.
  Bright Data returned an available post, an explicit user deletion and a
  matching `dead_page` error for a nonexistent id. Two runs each reported two
  billable records and one error. The retained run took 145.869 seconds at the
  provider and about 165 seconds including polling. Its estimated cost was
  $0.0030. The deleted description was localized; the explicit deleted title
  and author were the useful signal.

  ScrapeCreators' post endpoint returned the same 404 and zero credits for a
  live abbreviated URL, a removed post and a missing post. The full permalink
  returned the live post and charged one credit. The alternate comments
  endpoint charged one credit for each of three probes. It returned 200 for
  all three, but the removed and nonexistent posts held null content and no
  explicit deletion field. Neither endpoint supplies a reliable general
  deletion signal in these samples. Tests simulate explicit body markers;
  those markers remain unproven at this provider.

  Six ScrapeCreators credits and four Bright Data records across all probes
  cost an estimated $0.01728. `pnpm capture:deletions` reproduces the main
  capture; append `--comments` to capture the alternate endpoint. The fixtures
  and request manifest are retained in `sources/deletion-fixtures`.

  The deletion acceptance box remains open for ScrapeCreators. A provider
  outage or an unusable URL must not delete a match, and guessing from its
  ambiguous answers would violate the last acceptance box. Bright Data's
  deletion path is covered by captured responses. No real rate limit,
  timeout, or provider outage was exercised. See docs/deletions.md.

- 2026-09-05T20:01+08:00 — Final validation: 781 tests in 53 files passed with
  `pnpm test --maxWorkers=4` in 77.3 seconds. `pnpm lint`, `pnpm typecheck`,
  `pnpm build`, the backlog index check and `git diff --check` passed.
  The unconstrained suite reached Postgres's connection limit. The affected
  notification route file passed alone before concurrency was reduced.
  A final test also showed that a collection waiting on a snapshot must retain
  priority over new metered checks. The guard now reads that continuation too.
  No application database migration or deployment was performed.
