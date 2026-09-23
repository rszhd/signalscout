# Changelog

`@signalscout/engine` and `@signalscout/pipeline` share this file, because they
share a version. Both are published from one tag, and the pipeline depends on
the engine at that exact version. Upgrade both, or neither.
[docs/releasing.md](docs/releasing.md) is how a version is cut.

`@signalscout/ui` is here too, under its own heading, because it has its own
number and its own tag (`ui-vX.Y.Z`) and moves with neither of them.

**An entry says what a consumer must know**, not what the diff shows. A renamed
export, a changed option, a table that moved: those belong here. A refactor
nobody outside this repository can see does not.
[backlog/DONE.md](backlog/DONE.md) is the other record — every finished
ticket, including the ones that changed nothing a consumer imports.

**What the number means, and how it is chosen, is in
[docs/releasing.md](docs/releasing.md)** under *What the number means*: one
question — what must a consumer do to take this version — with nothing moving
the patch and something moving the minor. The app in this repository is not
versioned and is not described here; it is what `main` holds.

## @signalscout/ui — Unreleased

**Changed.** The package loads the font and sets the base type (US-369).
`styles.css` now loads Figtree at 400, 500, 600 and 700 and holds the base
rules — box sizing, the body's size, line height, letter spacing and
smoothing, and `font: inherit` for controls. **`@fontsource/figtree` is a
new peer dependency**: install it beside the package. A consumer deletes its
own Figtree imports and those base rules. A consumer that loaded no 600 face
drew every weight-600 rule at 700; it now draws them at 600.

**Added.** The navigation's parts (US-355): `NavItem`, `NavIcon` with its
icon names, `AccountIdentity` and `SignOut`, and the sidebar's look — the
sidebar, the phone's bottom bar and the account sheet — in the one
stylesheet. A consumer keeps its own shell and deletes its `.sidebar`,
`.nav-item`, `.signed-in-as`, `.sign-out` and `.account-sheet` rules. A rule
for an item only its navigation has must load after the package's.
`SignOut` no longer leaves an unhandled rejection when the server refuses.

**Added.** `Notifications`, the notification settings screen, with the
monitor's address and a `signingNotice` slot as props (US-354);
`LoginFrame`, the page around a sign-in form, with `storyNote` and `footer`;
and `DraftFromDocument`, with the `DraftedProject` type. Their rules are in
the one stylesheet. A consumer deletes its own `notifications.css`, the
`.login-page`/`.login-story`/`.login-header`/`.login-footer` rules, and the
`.draft-from-document`/`.draft-controls`/`.draft-file` rules, keeping only
the space its page gives the draft.

**Added.** The monitor page's parts (US-353): `MonitorStatus`, the status
pill; `MonitorHistory`, the polls and their stages, with optional paging;
`QueryPerformance`, with an optional note per row; and `LeadSources`, which
offers platforms, channels and intent unless the page names its groups. None
of them fetches; the page passes the rows. The words move with them:
`searchInputs`, `inputKey`, `leadGroupName`, `leadDimensionWords`,
`defaultLeadDimensions` and the row types. `@signalscout/ui/testing` adds
`pollEntry` and `stageEntry`. `.monitor-origin` and `.budget-error` join the
theme. A consumer deletes its own `.monitor-status`, `.poll-history`,
`.activity-*`, query and lead table rules. **Changed:** `MonitoringBar` renders
`MonitorStatus`, so a stopped monitor's pill is the danger colour there too.

**Added.** The inbox's parts (US-352): `MatchCard`, one row of the list;
`MatchDetail`, the reading pane, with a slot for a product's own action beside
the conversation link; and `MonitoringBar`, the line above both, which takes
the monitor's address. The words about a match move with them: `Match`,
`Verdict`, `whereItCameFrom`, `threadDepth`, `opensThreadOnly`,
`platformLabel` and `limitWords`. `@signalscout/ui/testing` adds a `match`
fixture. Their rules are in the one stylesheet, with the hosted look; a
consumer deletes its own copy of the inbox's `.match-*`, `.detail-*`,
`.verdict-*`, `.score-*` and `.inbox-monitoring*` rules. `.visually-hidden`
joins the theme.

**Fixed.** `Field` carries its own layout: the label, the hint and the control
on three lines, the input's border, padding and focus ring (BUG-356). Those
rules lived in each application's `index.css`, so the component looked right
only inside one that held them. `--focus-ring` joins the tokens. A consumer
deletes its own copy of the `.field` rules. **Check one thing when you do**:
the package's stylesheet loads after a consumer's base stylesheet, so a rule
there with the same specificity that styles an input inside a `Field` now
loses to the package's. Raise its specificity.

## @signalscout/ui — 0.1.0 — 2026-09-20

**Added.** The package itself: SignalScout's brand for both applications
(US-270). `tokens.css` and `theme.css`, the
`Button`, `Dialog` and `Field` primitives, `BrandIcon` and `BrandLogo`,
`requestJson`, and the words both products say about a monitor — the status
word, the poll and stage sentences, the badge, the ages and the money.
`@signalscout/ui/testing` carries the monitor and poll fixtures.
`ProjectCard` is the first shared
component that is not a primitive: the project card, with the status line, the
second action and the delete question as props (US-273). React,
`react-dom` and `react-router` are peer dependencies — the card links with the
router, because a plain anchor would reload the application, and the harness
under `@signalscout/ui/testing` renders (US-274). The schedule's words —
`pollRates`, `describeSchedule`, `summarise`, `pollRateLabel`, the day rules
and the timezone helpers — are exported too (US-275). `PageState` and
`FormError` are the state block and the error row, with their rules in
`theme.css` and the role each state carries decided by the component
(US-276); `--danger-soft` joins the tokens for them. `ReplyVoices` is the reply voice editor, the first whole
screen in the package (US-277); a consumer renders it on a route of its own.
`ReplyDraft` is the reply composer a match opens (US-278); `--warning-soft`
joins the tokens for its checks. **One stylesheet**: a consumer imports
`@signalscout/ui/styles.css` and nothing else — the tokens, the theme and every
component's rules, in cascade order (US-279). There are no per-file exports. Where
the two products differ the words take an argument:
`pollSummary(run, { spend: false })` is the hosted sentence, and
`Monitor.pausedByPlan` is the pause only a plan can perform. `BrandLogo`
takes a `size` and carries its one rule in the stylesheet, so a consumer
sets no rule for the mark (US-283).

## Unreleased

**Added.** A twin that takes the user id for each pipeline function that
addressed one monitor or match by id alone (US-336): `getOwnedMonitor`,
`updateOwnedMonitor`, `pauseOwnedMonitor`, `resumeOwnedMonitor`,
`deleteOwnedMonitor`, `getOwnedBudget`, `setOwnedBudget`, `clearOwnedBudget`,
`checkOwnedBudget`, `readOwnedNotificationSettings`,
`saveOwnedNotificationSettings` and `ownsMatch`. Each takes `userId` after the
database. For a monitor the account does not own, each answers what its twin
answers for an id that does not exist: `undefined`, `false`, `null`, or a
budget with no spend and no cap. `setOwnedBudget` and
`saveOwnedNotificationSettings` answer `undefined`, where their twins would
throw. The unchecked functions stay, unchanged, for a caller that acts for
the whole instance, such as the worker. New exports to call, so the version
is a minor.

## 0.14.0 — 2026-09-23

**Changed.** A provider's `Retry-After` is read one way for every connector
(US-334): seconds or an HTTP date, rounded up, and never more than an hour
(`maximumRetryAfterSeconds`). A wait of zero, a time already past or a value
that is not a wait takes the connector's own fallback, where three connectors
used to retry at once. A connector's `waitUntil` can therefore be earlier than
before for a long wait, and later for a zero one. No export changed.

**Changed.** `draftContext` takes the user id before the match id and
answers only for a match on that account's monitor (BUG-330). A consumer
that calls it passes the signed-in user. **Added.** `readOwnedEstimate(db,
userId, id)`, a cost test read that answers only for the account that started
it; `readEstimate` still answers for the whole instance, for the worker. A
changed signature on an export, so the version is a minor.

**Fixed.** `isPublicAddress` reads an IPv6 address by its groups, so every
spelling of one address gets one answer: an IPv4-mapped address in hex, as a
URL writes it, is checked as the IPv4 address it carries (BUG-328).
`assertPublicHost` accepts the bracketed literal `URL.hostname` returns and
checks it without a lookup.

## 0.13.1 — 2026-09-22

**Changed.** A monitor's first poll runs every search and charges every
search (US-291). Where the searches take turns, the poll that finds
`last_polled_at` empty runs the whole turn, and the balance goes as far
negative as the turn is heavy; the following hours repay it before the next
turn, as they do for one heavy unit. `nextTurn` takes `first`. Nothing
changes for a monitor that has polled, or where `poll_credits_per_hour` is
null. No migration and no new option on `startWorker`, so the version is a
patch.

## 0.13.0 — 2026-09-22

**Added.** A monitor's searches can take turns across the hour (US-289).
Migration 0067 adds `poll_credits_per_hour`, `poll_credit_balance` and
`poll_cursor` to `monitors`; migration 0068 adds `query` to
`source_coverage` and `source_continuations`, so a search keeps its own
window and paging state; `startWorker` takes `creditWeights`. With the first
column null nothing changes: every row written before carries the empty
query, which is the whole platform. `recordCoverage`, `rememberContinuation`
and `forgetContinuation` take the query — a consumer that calls them adds
it; the application does not. A migration and a new option, so the version
is a minor.

## 0.12.0 — 2026-09-21

**Added.** `startWorker` takes `newPostsPerPairPerDay`: the most posts one
pair — one query on one platform, as `post_discoveries` records it — may
put to the classifier in a UTC day, and the most reply pages it may buy
(US-287). Unset, nothing changes: every post is read, as before. Set, a post
past the number is stored and written to `filter_drops` under a new stage,
`ceiling`; migration 0066 widens `filter_drops_stage_known` for it, and
`FilterDropCounts` gains `ceiling`. A migration and a new field, so the
version is a minor.

**Changed.** A reason that only restates the scores no longer fails the
classification (BUG-288). The schema accepts the answer, the classifier
removes the reason afterwards, and a scored outcome carries
`removedReasons`. A consumer that constructs a `scored` outcome by hand adds
the field; one that reads the classifier sees fewer rejections.

**Added.** A fifth model task, `plan`, for writing a monitor's search plan
(US-269). `aiTasks` in the engine carries it, `AiEnvironment` takes
`AI_PLAN_PROVIDER`, `AI_PLAN_MODEL`, `AI_PLAN_API_KEY`, `AI_PLAN_BASE_URL`
and the two `AI_PLAN_*_PRICE_MICROS`, and `planConfigFromEnvironment` reads
them with the draft's fallbacks: every setting is the classifier's until one
is named. The pipeline lays an account's `plan` row over the environment the
way it lays the other four, and migration 0065 widens the
`ai_settings_task_known` check to accept the value. A consumer that writes
plans with `aiConfigFromEnvironment` keeps working and ignores the setting;
one that wants it calls `planConfigFromEnvironment`. A migration and a new
export, so the version is a minor.

**Added.** `readPollRuns` and `readStageRuns` take an optional fifth argument,
`before: Date`, and answer the rows that started strictly before it: the next
page, for a screen that holds the oldest `startedAt` of the page it has
(US-266). Absent, both read the newest page as before. A new optional
parameter, so the version is a minor.

**Changed.** `matchCounts` and `queryPerformance` count a match only at or
above its monitor's own `min_score`, and `queryPerformance` no longer counts
a hidden match, the way `matchCounts` never did (US-267). A monitor whose
floor was raised after matches were written reports fewer than before; the
rows are untouched. `QueryPerformance` gains `lastMatchedAt`, when a post the
input found last became a match. A consumer that shows either number sees it
move, so the version is a minor.

`packages/pipeline`'s `schema.ts` is a barrel over one file per table family
now (US-248); every export keeps its name and `drizzle-kit generate` produces
no migration.

## 0.11.0 — 2026-09-19

**Added.** `readMatch(db, userId, matchId)` returns one match in the shape a
page row has, or undefined for another account's id (US-234). `InboxFilters`
takes `matchId`. A new export, so the version is a minor.

**Changed.** The CSV from `matchesToCsv` has seventeen columns (US-237). The
column that held the intent label was named `intent` and is now
`intent_label`; a consumer that reads the file by heading must rename it. The
five dimension scores — `relevance`, `problem_fit`, `icp_fit`, `intent_score`,
`urgency` — follow `saved` as whole numbers. No other column changes meaning.

## 0.10.0 — 2026-09-19

**Added.** Triage can run on an evaluation model (US-230). `typesafe` joins
`aiProviders`, with `jev-latest` as its model, and it is the first provider
that can triage and cannot classify, draft or embed. A deployment opts in with
`AI_TRIAGE_PROVIDER=typesafe`, `AI_TRIAGE_MODEL=jev-latest` and a key in
`AI_TRIAGE_API_KEY`; one that sets none of them keeps the model it has.

New exports beside the existing ones: `createEvaluationModel`,
`evaluateChoice`, `isEvaluationProvider`, `defaultTriageConfidenceFloor`, the
type `EvaluationModelInstance`, and two errors —
`EvaluationProviderCannotChatError`, raised when an evaluation provider is
named for the classifier, and `NotAnEvaluationProviderError` for the reverse.
`createTriager` takes two optional settings, `evaluationModel` and
`confidenceFloor`.

**A `no` the model is unsure of keeps the item.** An evaluation model reports
how concentrated its answer is, and below `defaultTriageConfidenceFloor` — 0.6
— triage treats a refusal as not explicit enough to drop a lead on. This is the
stage's existing rule, one step further out, and it is load-bearing: two of the
six leads in US-229's sample are refused on every run and survive only because
of it.

**Changed.** `AiProvider` gained a member. An exhaustive `switch` over it in a
consumer will no longer compile until `typesafe` is handled, which is the only
thing in this release a consumer must react to. No migration:
`ai_keys.provider` and `ai_settings.provider` carry no check constraint.

`ai` moves from 7.0.92 to 7.0.106, because `experimental_evaluate` landed in
7.0.103.

**Fixed.** `live:triage-score --dry` estimates the models it is about to call
(US-233). It printed two constants measured once against one pair and ignored
`--model=` and `--triage-model=`; three runs in a day came in 3.9x, 6.1x and
0.9x against it. It now reads `modelPrices`, and errs high because a cached
score costs nothing and it prints before the cache is opened.

## 0.9.0 — 2026-09-19

**Added.** `accountSpendSince(db, userId, since)` and
`draftsSince(db, userId, since)` (US-216): the same two reads over a window
the caller chooses instead of the calendar month. `accountSpend` and
`draftsThisMonth` are unchanged and still count the calendar month, so a
consumer that does not bill for the usage can ignore both new exports.

They exist for a consumer that does bill. The month such a deployment cares
about is the one its customer paid for, which starts on the day they
subscribed. Counting a calendar month there gives an account that subscribed
on the 20th a whole allowance for eleven days and a second one on the first.

Separate names rather than a second argument on the existing two: both would
be a `Date`, the compiler could not tell them apart, and a call site left
behind by a change of window would count from the wrong moment without failing
to build.

**Changed.** A post the classifier says is not about this area cannot score as
a lead (US-225). `leadScore` now scales the weighted total by relevance when
relevance is under 40, so a post scored 0 for relevance scores 0 overall.
Before, intent and urgency carried 45% between them and a wholly off-topic post
could reach 42 and land in an inbox — found in a live one, where four of
seventeen matches were that shape.

Two new exports beside it, `relevanceFloor` and `relevanceGate`, for a consumer
that wants to explain or reproduce the number. **Scores will move**: anything
the classifier scored under 40 for relevance now scores lower, and nothing at
or above 40 changes at all. PLAN.md's four worked examples are unchanged.

**Changed.** An explicit ask always survives triage (US-223). A request for a
recommendation, for what others use, or for help with something of the author's
own is never refused, whatever the post looks like around it. DeepSeek Flash
refused a person asking for acne-scar recommendations because the post opened
like a product review, and a refusal leaves no row for anybody to notice.

**Changed.** Triage asks what the author wants, not only who the author is
(US-221). Three of the classifier's five dimensions are about the want, so a
plausible person who wanted nothing used to pass and buy a classification that
scored low. `maybe` is narrower: doubt about a want keeps the item, the plain
absence of one drops it, and a complaint with no question always keeps it.

Nothing to do to take it — no export, option or table moved. The effect is on
the bill and on what reaches the inbox. Over the same 46 hand-labelled comments
on `gpt-5.6-luna`, the stage keeps 13 where it kept 19, drops 23 of the 26
people answering where it dropped 20, and still keeps every worked example that
is a lead. The fail-open rule is unchanged: only an explicit `no` drops, and a
timeout, a refusal or bad JSON all keep the item.

## 0.8.0 — 2026-09-18

**Added.** `post_discoveries`: which of a monitor's phrases or channels found
which post. A connector answers `foundBy` on each page — one request carries
one input, so the page shares an answer — and the poll writes one row per
monitor, post and input. A post returned by two phrases keeps both: it was
earned by both, and the poll paid for both searches.

`queryPerformance(db, userId, monitorId)` reads it back, best first: posts
found, matches, the best score, and when the input last found anything. A
phrase that finds posts and never matches is the expensive kind of wrong, and
it had no way of showing itself.

`CandidatePost.foundBy` and `SearchResult.foundBy` are optional. A connector
that cannot say attributes nothing, and a post stored before this has no row.

Migration `0064` adds the table.

## 0.7.0 — 2026-09-18

**Added.** `stage_runs.poll_run_id`: the poll whose posts a stage processed.
`walk_id` says which collection, and a paging collection is several polls, so
the walk alone could not put a filter under the poll that fed it. Every
pipeline payload after the poll carries `pollRunId` beside `walkId`, and the
poll sends the id of the row it has just written rather than one looked up
afterwards, which would find whichever poll was running when the stage ended.

Two attributions are decisions. A reply's stages carry the poll that found its
thread, because the comments were collected by no poll of their own. And the
reference is `on delete set null`: `poll_runs` keeps 200 rows per monitor and
`stage_runs` keeps 800, so a stage outliving its poll is routine — the row
stays and loses only the reference.

Null on a job sent by an older worker, and on the notification sweep, which
belongs to no collection. Migration `0063` adds the column, its index and the
reference.

## 0.6.1 — 2026-09-18

**Fixed.** `stage_runs.detail.scored` on a classification is what the run
asked the model about, not what it was handed. It counted every candidate it
looked at, so a retry — handed the same post ids, skipping the ones already
scored — recorded a hundred and sixteen classifications it made in four
seconds and never paid for.

**Added.** `detail.skipped` beside it: the posts BUG-003's skip passed over,
because this monitor's current version had already scored them. Optional, so a
row written before this has none. `scored` plus `skipped` plus the failures is
what the run was handed.

The classifier's own log line carries both numbers too, so the row and the log
cannot drift.

## 0.6.0 — 2026-09-18

**Added.** `stage_runs.walk_id`: the collection a stage belonged to, the same
id `poll_runs.walk_id` carries. Every pipeline payload after the poll now
carries `walkId`, and each step passes it to the next, so a filter and a
classification can be shown beside the poll that fed them. A screen that reads
the rows by time alone cannot pair them: a paging walk is several polls whose
stages interleave.

Null on a row written by an older worker, and on the notification sweep, which
belongs to no collection. Migration `0062` adds the column and its index.

## 0.5.0 — 2026-09-18

**Added.** `stage_runs`: one row per run of the filter, replies, classify and
notify steps, written by the step itself. `readStageRuns(db, userId,
monitorId, limit)` answers for one monitor, newest first, scoped by owner, the
way `readPollRuns` is. A row says what went in, what came out, what it cost,
and a per-stage detail — the pre-filter's three drop counts, the classifier's
scored, matched, unclassified and cap-stopped counts, the replies stage's
threads and pages, the notifier's deliveries.

It answers the question `poll_runs` answers one stage later: a classifier that
stopped at the cap with five posts unread, a pre-filter that dropped forty on
triage, and a quiet week look identical from the other tables.

Migration `0061` creates the table. The vocabularies `stageNames`,
`stageOutcomes` and `stageStopReasons` are check constraints as well as arrays.

**Changed.** `processNotifications` returns `NotificationPass` — `{ planned,
sent }` — instead of nothing. A caller that ignored the return value is
unaffected.

## 0.4.0 — 2026-09-18

**Added.** `AI_TRIAGE=on|off` switches the triage stage off for a whole
deployment, and `triageIsOff` reads it. On is the default, so nothing changes
for an instance that does not set it.

Set it to `off` when triage and classification would run the same model.
Leaving `AI_TRIAGE_MODEL` blank does *not* switch the stage off — every triage
setting falls back to the classifier's, so a blank model means triage runs on
the classifier's own model, which is the most expensive arrangement available.
US-030 measured why: a triage answer is not cheaper than the classification it
avoids, so the whole saving is the price gap between two models, and with no
gap the stage costs 48% more.

`triageConfigFromEnvironment` is unchanged and still answers how a triager
would be built, so a capture that measures the stage keeps working on a
deployment that has switched it off.

## 0.3.0 — 2026-09-17

**Changed.** `recordModelCall` requires `userId`. A consumer's own routes —
drafts, query generation, project analysis, key tests — pass the session's
account; the worker passes the monitor's owner. `model_calls.user_id` is
added by pipeline migration 0060, which backfills it from the monitor where
there is one. US-162.

**Added.** `accountSpend(db, userId, now)` and `draftsThisMonth(db, userId,
now)` from the budget module: one account's month across both ledgers, and
its draft count, for a plan's allowance and limits. US-162.

**Changed.** `machineKeysUsable` and `providerKeyEnvironment` take a
`KeyPolicy` — `"account"` or `"instance"` — instead of a `SignupMode`. A
consumer passing a signup mode gets a type error, and passes
`keyPolicyOf(env)` or `loadKeyPolicyEnv()` instead. The default policy is the
old behaviour: `instance` when signup is closed, `account` when open. US-161.

**Added.** `MACHINE_KEYS` in `pipelineFields` and `signupEnvSchema`, the
`keys` option on `startWorker`, and `sharedInstance(signup)`, which is what
the webhook address guard and the shared signing secret now follow. A shared
instance may set `MACHINE_KEYS=instance` to pay for every account's polls and
model calls; the guard and the secret stay closed to its accounts. US-161.

## 0.2.0 — 2026-09-17

**Changed.** Four connectors that declared `canFetchReplies: false` now read
replies: ScrapeCreators YouTube, SocialCrawl Reddit, SocialData X and Apify
LinkedIn. A consumer that reads `canFetchRepliesFor` will offer replies on
every offered platform, and a monitor with replies on will spend at the
connector's `replyPricePerUnitMicros` — 1,880 on ScrapeCreators YouTube,
40,590 on SocialCrawl Reddit, 200 on SocialData X and 2,000 on Apify LinkedIn.
ScrapeCreators YouTube marks every reply `postedAtIsApproximate`. US-159.

**Changed.** Bright Data's Reddit connector is `notOffered`. It still ships and
still resumes a collection it started, and a recorded choice naming it is
refused. US-158.

**Added.** `Page.truncated` on the SocialCrawl client, set from the Reddit
comment envelope. `flatten` from `socialcrawl/reddit`, `flattenComments` from
`apify/linkedin`, and a `toCandidateReply` from each of the four connectors.

## 0.1.2 — 2026-09-16

Nothing to do. The packages are published through npm trusted publishing now,
so no token exists anywhere. No code changed between 0.1.1 and this.

## 0.1.1 — 2026-09-16

**Added.** `@signalscout/pipeline/testing` exports `insertMonitor` and
`fastRetries`. A consumer's test can now build a monitor row and make a retry
policy take no real time, the way this repository's tests do.

Nothing else changes.

## 0.1.0 — 2026-09-16

First publish. The split that US-152 and US-153 made, as npm packages.

**`@signalscout/engine`** — stateless. Connectors for Reddit, X, LinkedIn,
YouTube, TikTok and Instagram through Bright Data, ScrapeCreators, SocialCrawl,
SocialData and Apify, behind one `SocialSource` interface. Model calls over the
Vercel AI SDK: query writing, triage, classification, reply drafting,
embeddings. The pre-filter's keyword stage, the cost arithmetic, the
AES-256-GCM cipher, and the product's vocabulary. Test helpers at
`@signalscout/engine/testing`.

**`@signalscout/pipeline`** — stateful. The monitor, post, match, ledger and
budget tables with their migrations; the five queues and the scheduler that
feeds them; the budget guard; notification delivery by email and webhook. Test
helpers at `@signalscout/pipeline/testing`.

**The boundary, which is the point of publishing at all.** The engine reads no
environment variable and declares no database. The pipeline owns only its own
tables and knows an owner as a text id. Neither knows an account. Login,
billing and the rule for who may poll belong to the application on top.

**Requires.** Node 24 or newer, ESM only. The pipeline needs one Postgres 17
database with `pgvector`, and nothing else.
