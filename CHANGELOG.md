# Changelog

`@signalscout/engine` and `@signalscout/pipeline` share this file, because they
share a version. Both are published from one tag, and the pipeline depends on
the engine at that exact version. Upgrade both, or neither.
[docs/releasing.md](docs/releasing.md) is how a version is cut.

**An entry says what a consumer must know**, not what the diff shows. A renamed
export, a changed option, a table that moved: those belong here. A refactor
nobody outside this repository can see does not.
[docs/history.md](docs/history.md) is the other record — every ticket, in the
order it happened, including the ones that changed nothing a consumer imports.

Before 1.0, a change a consumer must react to moves the minor and anything else
moves the patch. The app in this repository is not versioned and is not
described here; it is what `main` holds.

## Unreleased

Nothing yet.

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
