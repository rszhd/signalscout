# Deleted conversations

The worker re-checks matched posts. A definite deletion hides every match for
that post, including saved and dismissed matches. Scores, reasons and feedback
remain in the database. The post row holds a deletion timestamp, so a late
classification cannot put it back in the inbox. Notification delivery excludes
hidden matches too. Already delivered emails and webhooks cannot be recalled.

Checks run oldest verification first. For posts under seven days old, unread
matches are checked daily and read matches every three days. Older unread
matches are checked weekly, and older read matches every thirty days. These
intervals are conservative starting values, not measured freshness guarantees.
The scheduler runs once a minute and each job checks at most twenty posts.

One post shared by several monitors is checked once. Its result updates every
match. The monitor that starts the check pays for it. A paused monitor still
has an inbox, so its matches remain eligible for checks within its budget.
New metered checks yield to due and active polls, and to collections waiting
on a snapshot. The budget is checked before
each call. As with polling, the final call can overshoot the cap because its
cost is known only after it answers. Checks use the selected provider and the
same estimated usage ledger as collection. A check is not assumed free on
Reddit. See [costs.md](costs.md).

A Bright Data check starts a snapshot. Its provider, cursor and paying monitor
are stored in Postgres. A restart or provider switch resumes that snapshot.
The cap also applies to resumes. If the paying monitor is deleted while a
snapshot is pending, that check is left pending rather than charged to someone
else. A lost response may have been billed without reporting its units, as
with a failed collection.

An outage, inaccessible post, malformed response or unsupported verification
method leaves the match visible. An uncertain answer is retried after a day.
It does not advance `last_verified_at`. A provider that requests a later retry
supplies that time instead. Successful available and deleted answers advance
the verification time for every match of that post.

## What has run against providers

`pnpm capture:deletions` records a small, bounded set of live provider responses.
It reads keys from `.env`, costs about $0.02, and never runs in the test suite.
The captured responses and request manifest live in
`packages/core/src/sources/deletion-fixtures/`.

Bright Data returned a normal post, an explicitly deleted post, and a
`dead_page` record saying that the post was absent from Reddit's JSON response.
The parser requires the requested post id or the matching input URL. An empty
snapshot or an arbitrary error cannot hide anything. The deleted description
was localized; the explicit deleted title and author identified it.

ScrapeCreators returned the same 404 for a missing post, a removed post, and a
live post requested with an abbreviated URL. The live post succeeded with its
full permalink. Therefore a ScrapeCreators 404 is uncertain. The connector
recognizes explicit `[deleted]` and `[removed]` body markers, but those branches
have not been observed through its post endpoint. A second probe used the comments endpoint. It
charged one credit and returned 200 with null content for both removed and
nonexistent posts, with no explicit deletion field. The capture can be repeated
with `pnpm capture:deletions --comments`. **Automatic deletion through
ScrapeCreators remains unproven, and its ambiguous 404s leave content visible.**

Real rate limits, timeouts and provider outages have not been exercised for
verification. Tests simulate our response to them. The live capture verifies
the provider formats; the scheduled worker and database behavior are tested
against real Postgres with injected connector responses.
