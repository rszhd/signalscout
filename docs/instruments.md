# The instruments

These are the only commands in this repository that spend money. Each asks a
real provider or a real model something and records what it said, because an
answer we wrote would be evidence about our own schema and none about the
provider. What each first run found is in the Log of the ticket that added
the instrument.

Three rules cover all of them.

**Read what a capture writes before you commit it.** Three captures leaked a
real name or handle past a scrubber that looked right.

**Naming the platform is required** on `live-poll.ts`, because a live poll
spends money and a default would let a mistyped flag bill the wrong account.

**Re-run one when its prompt, its schema or the model changes**, and put the
numbers in the ticket.

## A change that can move a score is measured before it ships

Anything that changes what reaches an inbox — the triage prompt, the
classifier prompt, the pre-filter, a threshold, a model — runs this loop:

1. `capture:triage`, then `capture:scores`: the fifty hand-labelled items,
   about three cents. Read whether the leads survived before anything else.
2. If that looks right, `live:triage-score`: everything this instance has
   stored, every platform, posts and replies, about fifteen cents.
3. Tighten or loosen, and go round again.

**Every capture takes `--model=` and writes a file per model.** A second model
never overwrites the first, and `capture:compare` prints one table over
whatever has been captured, calling nothing. `ai/fixtures/pinned.ts` names the
pair the product sends; changing a name there is a promotion and the last
step, and the suite goes red until the matching capture exists.

**A score is bought once and reused.** Both scoring instruments cache under a
hash of the exact system prompt, so editing the prompt, a monitor or the
model throws the cache away by itself; `--rescore` forces it. Two runs over
the same fifty on one day differed by 2.4 points an item, and that drift
reads as triage having changed something.

**`ai/triage-scores.test.ts` goes red the moment the classifier's prompt
moves.** It is not an assertion to fix: re-run the two captures and put the
numbers in the ticket.

**Both halves are needed.** A keep rate says the stage drops more; only a
score beside a verdict says it drops the right ones, and a triage drop leaves
no row, so the classification is bought deliberately, outside the pipeline.
**Fifty items from two Reddit threads is not a distribution**, which is why
step 2 exists and caps its sample per platform and kind.

## How they are run

Every `capture:*` is a script of `packages/engine`, every `live:*` and
`measure:*` a script of `packages/pipeline`, and the captures with no script
are run by hand with a key in the environment:

    pnpm --filter @signalscout/engine capture:<name>
    pnpm --filter @signalscout/pipeline live:<name>
    pnpm capture:deletions
    node packages/engine/src/sources/providers/<provider>/<platform>-fixtures/capture.mjs

## The model instruments

| Command | Asks | Spends | Run when |
|---|---|---|---|
| `live:model-probe` | Does this provider answer `generateObject`? The Models screen's Test button with no account behind it. Reads `AI_*`; `--provider=`, `--model=` override. Writes nothing. | one call | a provider is added |
| `capture:classifier` | Scores PLAN.md's four worked examples; fixtures for `ai/examples.test.ts`; the scores that justify `min_score`. | four calls | the classifier prompt or model changes |
| `capture:queries` | Writes the example monitor's search queries. Read the output: a subreddit that does not exist and eight queries that are one query are invisible to the schema. | one call | the query prompt changes |
| `capture:triage` | Triages the 46 hand-labelled comments plus the four examples; fixtures for `ai/triage-examples.test.ts`. Read the kept-asking number rather than counting it: a refusal of an off-product ask is not a fault. | fifty short calls | the triage prompt or model changes |
| `capture:scores` | Classifies the same fifty and puts the score beside the verdict. Needs `capture:triage` first (`--triage-model=`). One file per pair of models. | ~1.5¢ on `gpt-5.6-luna`, 14¢ on `gpt-5.6-terra`, nothing on a re-run under the same prompt | after `capture:triage` |
| `capture:embeddings` | Similarity of PLAN.md's five posts to the example monitor; replayed by `ai/similarity.test.ts`. Needs an embedding provider; Anthropic has none. | two calls | the threshold or the embedding model changes |
| `capture:comment-filter` | What the embedding stage does to a Reddit comment, alone and under its parent's title, on the committed thread. | two calls, 3,009 tokens | `filter/description.ts` changes |

Both scoring captures read `labelled-subjects.ts`, so the fifty are the same
fifty in the same order; two copies would drift and a score would sit beside
the wrong verdict without anything going red.

**`evals/triage`** compares triage *rules* over one `live:triage-score`
sample — which of two rules drops better, where `capture:scores` asks what a
drop was worth. `pnpm eval:dataset <run record>` and `pnpm eval:summary` spend
nothing; `pnpm eval:triage` is about $0.03 for three rules over 227 items.
Each rule is a provider under `evals/triage/providers/` answering `keep` or
`drop`; the shipped one imports `createTriager` so it cannot drift. The
dataset build refuses when `posts` holds less text than the run record: a
harness judging one rule on a 300-character excerpt produced a worthless
comparison that looked fine. `promptfoo eval` exits 100 when assertions fail,
which is the ordinary outcome.

## The pipeline instruments

`live-poll.ts` creates a paused monitor with one query and a cap, then drives
collect, pre-filter and classify with a queue that runs the next step instead
of enqueuing it. It leaves the monitor, its posts, an `api_usage` row and its
matches. Run one after changing its connector, and read `api_usage`
afterwards: the run is evidence only if the row is priced by the connector.

| Command | Provider half | Notes |
|---|---|---|
| `live:x-poll` (`--platform=x --provider=socialdata`) | ~$0.0014 for 7 tweets | The one with a provider-side window; `--since-hours=` defaults to 24 and without it the window is never sent. |
| `live:sc-tiktok-poll`, `live:sc-youtube-poll` | 2 credits, ~$0.004 | The cheapest polls; the model half is what costs. |
| `live:apify-linkedin-poll` | ~$0.052 for 25 posts | The one that exercises a waiting collection. The pre-filter drops nothing on LinkedIn. |
| `live:harvestapi-linkedin-poll` | $0.004 for up to 50 posts | One request per query. The model half is the larger bill here. |
| `live:linkedin-poll` | ~$0.081 | **Refused as written**: SocialCrawl LinkedIn is switched off. Pass `--provider=apify`, or delete `notOffered` to re-measure. |
| `live:tiktok-poll` | ~$0.37, then a triage call per comment | Turns replies on: 25 threads and 678 comments. Capped, and both paid stages stop at the cap. |
| `live:instagram-poll` | ~$1.63 against $0.33 of model | **The most expensive poll here.** The first run overshot a $1.00 cap by 63%. |
| `live:tiktok-comments`, `live:instagram-comments` | nothing | Read comments **already stored** through triage and classification. Skip anything the monitor already paid to read. Use these when the question is the classifier, not the connector. |
| `live:thread-loop` | the cap you pass, in dollars | One job, and `classify` handing the thread back to `replies` — the only way to see the loop turn. Leaves its own paused monitor. |
| `live:triage-score` | ~$0.15 | Everything stored, `--per-cell=` per platform and kind, classifies every sampled item whatever triage said, reports drops against each monitor's own `min_score`. **Writes nothing**, so its spend is invisible to every screen; `--dry` estimates. |
| `measure:lead-position` | ~$0.40 | Pages a thread cheaply and classifies only the positions asked for. `--report-only` re-reads a stopped run. |
| `live:provider-switch` | ~$0.08 | Starts a Bright Data collection and moves the choice mid-snapshot. **Refused as written** since US-158; delete `notOffered` from `brightdata/reddit.ts` to run it. No other pair can measure this: only Bright Data collects asynchronously. |
| `live:webhook` | nothing | A signed delivery verifies, a different secret rejects, the hosted guard refuses. Resets delivery rows between the three. |
| `live:notification` | model only | A match reaches SMTP, in the real order. `--channel=` aims the sample and `--oldest` flips it; the newest twenty scored nothing where the oldest forty produced six. |

## The captures

Each is run by hand with a key, writes its fixtures and a `ledger.json` of
what each call cost, and merges a partial run into the folder's manifest.

| Script | Spends | Free calls and traps |
|---|---|---|
| `socialcrawl/linkedin-fixtures/capture.mjs` | 5 × 5 credits + 4 free probes | Run when the LinkedIn parser changes. |
| `socialcrawl/instagram-fixtures/capture.mjs` | 24 credits; `--lean` 14 | `--lean` drops the hashtag search and the second `top` page. **The committed fixtures came from a lean run**, so those two questions are open. |
| `socialcrawl/reddit-fixtures/capture.mjs --only=comments` | 5 credits, $0.041 | Reads the whole thread in one call. |
| `socialdata/x-fixtures/capture.mjs --only=comments` | ~$0.012 | Prepaid; an empty balance answers 402. Read the balance it prints first. |
| `apify/linkedin-fixtures/capture.mjs --only=comments` | ~$0.008 | The comments actor twice, with and without `scrapeReplies`. |
| `harvestapi/linkedin-fixtures/capture.mjs` | 5 requests, $0.020 | `--only=credentials` is free: a refused key and the account read. `--rescrub` re-scrubs the last answers from the system temporary folder, buying nothing. An empty search is billed. |
| `scrapecreators/tiktok-fixtures/capture.mjs` | 9 credits, ~$0.017 | A key with no query and a malformed URL are free. An invalid parameter value is **billed**; read `docs.scrapecreators.com/openapi.json` instead. Writes one whole video and a digest per page: a page is 1.8 MB. |
| `scrapecreators/youtube-fixtures/capture.mjs` | 8 credits; `--only=comments` ~$0.008 | `includeExtras` is what fills the description and the real `publishDate`. The transcript endpoint is a credit a video. `uploadDate` narrows and leaks. |
| `scrapecreators/instagram-fixtures/capture.mjs` | 6 credits | Two endpoints: the topic page has no dates, the reels search has everything. A search matching nothing, a page past the last and a key with no query are all free. |
| `hikerapi/instagram-fixtures/capture.mjs` | 5 requests, ~half a cent | **No free "nothing"**: an empty search returns six unrelated reels and bills. Sends `safe_int=true` because a media `pk` is nineteen digits and `JSON.parse` rounds it. Read the run's balance total, not a call's. |
| `pnpm capture:deletions` | ~$0.02 | Known available, removed and missing Reddit URLs through both providers; `--comments` probes the alternate endpoint. Writes fixtures, never application rows. |

**Read `comment_count` before asking for comments.** It is in the search
answer; two captures paid for an empty comment page before reading it.

`--only=comments` on the four captures that have it takes its thread from a
fixture already committed rather than buying a search, except YouTube, whose
niche videos have no comments: it spends one credit on a broader search
first.
