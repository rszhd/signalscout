# How a poll becomes a match

[PLAN.md](../PLAN.md)'s *Monitoring flow* says what the pipeline is for. This
says how it runs: what asks for work, what stops it, where it keeps its place,
and which row each step leaves behind.

Read it before changing anything in `packages/pipeline/src/worker/`, and when a
screen shows a number nobody can explain.

## Five queues and a clock

The worker serves five pipeline queues — `poll`, `filter`, `replies`,
`classify`, `notify` — and a scheduler tick on a `pg-boss` cron of one minute.
The steps are separate queues rather than one long job because they fail
differently and cost differently: a model provider that is down must not make
the poll re-fetch posts that were already paid for, and a retry of the classify
step must never re-run the poll step.

A job carries ids, never payloads. Retrying a step reads rows that are already
stored.

Every pipeline job also carries two ids that explain nothing to the worker and
everything to a screen: `walkId`, the collection it belongs to, and
`pollRunId`, the poll inside that collection whose posts it is processing.

## One tick

`findDueMonitors` asks for monitors that are not paused, name at least one
platform, are inside one of their own polling days *in their own time zone*,
and whose last poll is older than their interval.

Every due monitor gets one poll job, keyed by the monitor. `pg-boss`'s
`stately` policy allows one queued, one active and one retrying job per key, so
two workers ticking at the same second cannot poll one monitor twice.

The same tick sweeps notifications, which is a different thing and is described
at the end.

## One poll

1. **Read the monitor and check the budget.** A monitor at its monthly cap
   writes a `refused` poll row and asks no provider anything. US-013.
2. **Take the platforms one at a time.** Each platform has its own connector,
   its own phrases, its own cursor and its own line in the poll's row.
3. **Pick the connector** — the platform plus the provider chosen for it. No
   key, or no choice between two providers, is a reason recorded against that
   platform, and the poll moves on to the next one.
4. **Load that platform's phrases.** A phrase written for Reddit is never sent
   to X. US-027.
5. **Load the cursor**, which is where the last poll stopped for this platform.
   Absent means start at the beginning.
6. **The connector walks its inputs.** Keyword one, page one, page two; then
   keyword two; and when the keywords are done, the channels. One request
   carries one input.
7. **Stop** at five pages for this platform, or when the inputs are exhausted,
   or when the provider says it needs more time.
8. **Count every page as it arrives.** A platform that throws on its third page
   still reports the two it was billed for.

Then, once for the whole poll:

9. **Merge and deduplicate.** The same post returned by two keywords is one
   post. `posts` is keyed by `(source, external_id)`, so a post another monitor
   already stored is not stored again — and `posts_new` is the number that says
   so.
10. **Write the poll row.** Outcome, posts returned, posts new, units, cost,
    one entry per platform with its own reason, and the walk it belongs to.
11. **Resume or finish.** A platform that stopped part way keeps its cursor and
    the poll books its own next poll with an alarm. That poll continues the
    same walk. A platform that finished forgets its cursor and records the time
    window it covered, so the next walk knows where to start.
12. **Hand the posts on** to the filter, with the walk and the poll id.

## Where the pipeline keeps its place

Four markers, each answering a different question. This is the part that is
hard to guess from the code:

| Marker | Where it lives | What it remembers |
| --- | --- | --- |
| Walk | `poll_runs.walk_id` | Which polls are one collection |
| Cursor | `source_continuations` | Where a platform stopped, per provider |
| Input index | inside the cursor | Which keyword or channel is next |
| Provider place | inside the cursor | The page inside that one input |

Nothing is bought twice and nothing is skipped, and every one of those markers
exists because something was once bought twice. BUG-001 is the cursor's.

The same fact travels one step further for a different reason. A connector
answers `foundBy` on the page — which phrase or channel this request was for —
because one request carries one input. The collector copies it onto each post
as it merges pages, and writes `post_discoveries` after the batch is stored.
US-212: that is the only moment anything knows which search produced a post,
and a provider's search is not a substring match, so it cannot be worked out
later.

## The caps, and what each one is for

| Cap | Value | What it stops |
| --- | --- | --- |
| Pages per poll, per platform | 5 | One poll spending without bound. A page's cost is known only after it is fetched |
| Pages per input | 2 on Reddit | One keyword eating a whole poll |
| Threads per replies job | 25 | One job opening every thread a poll found |
| Pages per thread | 4 | One conversation paging for ever |
| Comments per thread | 500 | A thread that grows faster than it is read |
| Classification attempts per post | 3 | A post the model refuses being paid for on every poll |
| Job attempts | 4, backing off from 30s | A job that throws for ever, retrying all night |
| Posts per pair per day | unset; the application's | One search putting its whole backlog, or a busy day, to the classifier |

The monthly cap in `budgets` is the limit on what a monitor may spend. These
are the limits on how far one job can carry it past that before the next check.

**A monitor's platforms can take turns across the hour.** US-289. Off
unless an application sets `poll_credits_per_hour` on the monitor, beside an
hourly `poll_interval_seconds`; null is what every monitor did before, every
platform every poll. Set, each poll adds that many credits to
`poll_credit_balance` and runs the next platforms in turn from `poll_cursor`
— the first while the balance is above zero, so a platform heavier than the
hour runs and is repaid over the following hours; each further one only
while the balance covers it. A platform's cost is its searches times the
platform's weight, from `creditWeights` on `startWorker`. A poll that picks
none marks `last_polled_at`, logs at debug, and writes no poll run. The
"seen up to" window and the paging state stay per platform, which is why
the turn is a platform and not a search. `worker/rotation.ts` is the rule.

**The ceiling row is off unless an application sets it.** US-287. A pair is one
query on one platform, as `post_discoveries` records it; the number is how
many posts the pairs that found a post may put to the classifier in a UTC day,
and how many reply pages they may buy. `startWorker` takes it as
`newPostsPerPairPerDay`, the way it takes the entitlement gate: a hosted
product sizes its plans on it, and a self-hosted instance reads every post it
finds. `worker/ceiling.ts` is the rule; the count is the ledger's
(`model_calls` joined to the discoveries), and a post refused is written to
`filter_drops` under the stage `ceiling` and not read on a later day.

## After the poll

**Filter.** Keywords and channel first, free, in Postgres. Then embedding
similarity, one call for the batch. Then triage, one cheap model call per post,
if the deployment has it switched on. Every drop is written to `filter_drops`
with the similarity that caused it, because a threshold nobody can review is a
number somebody guessed twice. Survivors go to the classifier; the posts among
them also go to the replies stage when the monitor reads comments.

**Replies.** Buys a thread's comments in batches, stores each as a post of kind
`reply`, and sends them back through the filter — where a reply meets triage
and nothing else. A thread stops when it ends, when it hits its ceiling, or
when a batch holds no lead.

**Classify.** One model call per post, one at a time, because the provider's
rate limit is the binding constraint. A post already scored for this monitor at
this version is skipped and not paid for again — the skip is asked of the call
ledger, not of `matches`, because a post scored below the threshold writes no
match. A score at or above the monitor's threshold becomes a match.

**Notify.** Immediate email for a match above `immediate_score`, one delivery
per match. Digest for everything above `min_score`, up to a hundred matches in
one delivery, on the monitor's own digest clock. The scheduler's tick also
sweeps every monitor with settings, so a lost enqueue cannot lose a match.

## What each step writes

| Step | Rows |
| --- | --- |
| Poll | `poll_runs`, `posts`, `post_discoveries`, `api_usage`, `source_continuations`, `source_coverage` |
| Filter | `stage_runs`, `filter_drops`, `model_calls` (embedding, triage) |
| Replies | `stage_runs`, `posts`, `api_usage` |
| Classify | `stage_runs`, `model_calls`, `matches` |
| Notify | `stage_runs`, `notification_deliveries` |

`poll_runs` keeps 200 rows per monitor and `stage_runs` keeps 800, so a stage
row outlives its poll row routinely. When the poll is trimmed, the stage keeps
its walk and loses its `poll_run_id`. A screen reads that as "this collection,
poll unknown" and must not guess.
