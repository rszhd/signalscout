# The instruments

These are the only commands in this repository that spend money. Each one asks
a real provider or a real model something and records what it said, because an
answer we wrote would be evidence about our own schema and none about the
provider.

Three rules cover all of them.

**Read what a capture writes before you commit it.** The LinkedIn capture's
first run leaked real names and job headlines past a scrubber that looked
right.

**Naming the platform is required** on `live-poll.ts`, because a live poll
spends money and a default would let a mistyped flag bill the wrong account.

**Re-run one when its prompt, its schema or the model changes**, and put the
numbers in the ticket.

because an answer we wrote would be evidence about our own schema and none
about the provider.

`live:model-probe` asks one provider whether it answers the call this product
actually makes. It is the cheapest instrument here — one sentence in, one
boolean out, through `generateObject`, which is the Test button on the Models
screen with no account behind it. Run it when a provider is added. A provider
that speaks the OpenAI wire format is not by that fact a provider that speaks
structured output: DeepSeek publishes `response_format: json_object` and no
JSON schema, so the AI SDK puts the schema in the prompt instead, and only a
real call says whether the answer comes back usable. It reads `AI_PROVIDER`,
`AI_MODEL`, `AI_API_KEY` and `AI_BASE_URL`; `--provider=` and `--model=`
override the first two, and the key must belong to the provider probed. It
writes nothing, because there is no account here to bill.

`capture:classifier` scores PLAN.md's four worked examples, records the answers
as the fixtures `ai/examples.test.ts` replays, and prints the scores that
justify the default `min_score`. Four short calls.

`capture:queries` writes the search queries for the same example monitor and
records them. One short call. Read its output rather than trusting it: two
failures are invisible to the schema, a subreddit that does not exist and eight
queries that are one query written eight ways.

`capture:triage` asks a real model to triage all 46 comments US-029 labelled by
hand and PLAN.md's four worked examples, and records the answers as the fixtures
`ai/triage-examples.test.ts` replays. Fifty short calls, one word back each. It
prints the two numbers that decide the stage: how many people asking it kept and
how many people answering it dropped. Read the first one rather than counting
it — a person asking for a native-app tool is asking, and a monitor selling a
browser test runner should not reach them, so a refusal there is not
automatically a fault.

`capture:embeddings` measures how near each of PLAN.md's five posts is to the
example monitor, and records the similarities — not the vectors, which would be
a quarter of a megabyte to re-prove arithmetic `pgvector` already does.
`ai/similarity.test.ts` replays them and fails if the default threshold leaves
the measured gap. Two short calls, well under a hundredth of a cent. It needs
an embedding provider: Anthropic has none.

`capture:comment-filter` asks what the embedding stage would do to a Reddit
comment. It reads the thread already committed in
`sources/deletion-fixtures/`, and the hand labels beside it, and embeds every
comment twice — alone, and under its parent post's title. Two short calls, 3,009
tokens. Run it when `filter/description.ts` changes, or against a second thread.
US-029's answer is recorded in its Log and it is the reason the stage is off for
comments.

`live:provider-switch` is the fourth, and it is different in kind: it asks two
real social-data providers rather than a model, and it writes rows. It starts a
Bright Data collection, moves the recorded provider to ScrapeCreators while
that snapshot is still collecting, and reports which provider each resume went
to and what each one billed. It spends about $0.08 and leaves behind a paused
monitor and two `api_usage` rows, which are the evidence. Run it when
`collect.ts` changes how a provider is chosen or resumed.

The LinkedIn capture is the sixth, and it has no `package.json` script because
it is run by hand with a key: `node
packages/core/src/sources/providers/socialcrawl/linkedin-fixtures/capture.mjs`.
It makes five billed calls at five credits each, plus four probes that are free,
and it writes `ledger.json` beside the fixtures recording what each one cost.
Run it when the LinkedIn parser changes. Read the fixtures it writes before you
commit them — its first run leaked real names past a scrubber that looked right.

`live:linkedin-poll` is US-028's equivalent, **and it no longer runs on
SocialCrawl**: US-053 switched that connector off, so the poll it drives is
refused like any other. Pass `--provider=apify`, or delete `notOffered` from
`socialcrawl/linkedin.ts` to re-measure the connector this paragraph describes.
The script behind it is
`live-poll.ts`, and it takes `--platform=` — naming it is required, because a
live poll spends money and a default would let a mistyped flag bill the wrong
account. It, and it is a whole pipeline rather
than one connector: it creates a paused monitor with one LinkedIn query and a
$0.20 cap, then drives collect, pre-filter and classify with a queue that runs
the next step instead of enqueuing it. The steps are the real ones in the real
order. It spends about $0.081 of SocialCrawl credit plus one model call per post
that survives the filter, and it leaves a paused monitor, its posts, one
`api_usage` row and its matches. Run it when the LinkedIn connector changes, or
to prove deduplication — a second run inside the same window should store no new
post and should bill again, because the provider charges for the search.

`live:x-poll` is the same script with `--platform=x --provider=socialdata`. It
is the cheapest live poll here — a 24-hour window bought 7 tweets for $0.0014 —
and it is the one that exercises a provider-side window. `--since-hours=`
controls it and defaults to 24; a monitor this script creates has never polled,
so without a `since` the window is never sent and the run proves nothing.

`live:apify-linkedin-poll` is the same script with `--provider=apify`, and it
is the one that exercises a waiting collection: the Apify connector starts an
actor run, hands the wait back, and is resumed to read it. One run is 25 posts
for about $0.052, plus a model call for each — the pre-filter drops none on this
platform. It records the provider choice, so a build with two LinkedIn
connectors does not refuse.

`live:tiktok-poll` is the TikTok equivalent of `live:linkedin-poll`, and it
turns replies on. Read its cost before running it: the search is 2 credits, but
25 threads is 25 more, and 678 comments then buy a triage call each and a
classification for most of them. The provider half is about $0.37 and the model
half is several times that. It is capped, and both paid stages stop at the cap.

`live:tiktok-comments` is the cheap half of that question. It reads comments
**already stored** — no search, no thread, no provider call at all — and puts a
sample through triage and classification in the real order. Sixty comments cost
$0.198 on 2026-09-06. It skips any comment the monitor has already paid to
read, so a second run with a larger sample buys no answer twice. Use it rather
than a second poll whenever the question is about the classifier and not about
the connector.

`live:instagram-poll` is the Instagram equivalent, and it is the **most
expensive poll here**. A search page is 1 credit and a comment page is 5, so the
provider half dominates: one run spent $1.6317 with SocialCrawl against $0.3336
with the model, which is the reverse of every other platform. Pass it a cap you
mean, and expect it to be exceeded — the first run overshot $1.00 by 63%.

`live:instagram-comments` is the cheap half of that question and it is the same
script as `live:tiktok-comments`, which US-049 taught to take `--platform=`. It
reads comments **already stored**, calls no provider, and skips any the monitor
has already paid to read. Use it rather than a second poll whenever the question
is about the classifier and not about the connector — on Instagram that is
almost always, because the connector's half is the expensive one.

`live:thread-loop` reads one deep thread through the **real loop** rather than
one batch at a time. It sends a single job and everything after it is
`classify` handing the thread back to `replies`, which is the only way to see
the loop turn: every test drives one batch per job and two batches never meet.
Pass the cap in dollars — the budget is what ends it on a thread that keeps
producing leads, and that is itself a stop reason worth seeing. It leaves a
paused monitor of its own, so it never skips comments an older monitor has
already classified.

`live:webhook` answers whether a signed webhook arrives and verifies. It starts
an HTTPS receiver on this machine, makes the account a signing secret, and
delivers matches this instance already holds — no provider and no model, so it
spends nothing. It answers three things: a delivery signed with the account's
own secret verifies; the same receiver holding a different secret rejects one;
and with the hosted guard on the same URL is refused before the request. It
resets the delivery rows between the three, which is the one thing here a real
deployment never does. Run it when the signing or the address guard changes.

`live:notification` answers whether a match ever reaches a person. It calls no
provider: it creates a monitor through `createMonitor`, reads posts **already
stored**, filters and classifies them in the real order, and hands the result to
the real SMTP transport. `--channel=` aims the sample and `--oldest` flips its
order, and both matter — twenty newest posts scored nothing at 50 where the
oldest forty produced six matches. Run it when the notification defaults or the
delivery rules change. It leaves a paused monitor, its settings row, its matches
and its delivery rows.

`measure:lead-position` answers whether this product's leads sit where the
platform ranks highest. It pages a thread cheaply and classifies only the
positions asked for, because fetching is a credit for fifty comments and a
classification is 2,975 micro-dollars. `--report-only` re-reads a run that the
budget stopped, buying nothing.

The Instagram capture is run by hand with a key, like LinkedIn's, and it takes
`--lean`. The full run is 24 credits and answers nine questions; `--lean` is 14
and drops the two 5-credit calls that answer a question rather than feed the
parser — the hashtag search, and the second `top` comment page that tests whether
a `top` walk repeats itself. **The committed fixtures came from a lean run**, so
those two questions are open rather than answered. It prints the two numbers the
platform is judged on: whether paging buys new posts, and how long a comment is.

`capture:deletions` checks known available, removed and missing Reddit URLs.
It retains whole provider responses with author identity scrubbed. The default
run asks both providers; `--comments` probes ScrapeCreators' alternate endpoint.
It writes fixture files and a request manifest, never application rows. Read
docs/deletions.md for what each provider has and has not proved.

The ScrapeCreators TikTok capture is run by hand with a key, like the Instagram
and LinkedIn ones. It answers the ten questions US-119 asks and spends 9
credits, about $0.017. Two of its calls are free and are worth knowing about
before you spend anything here: a key with no query answers 400 and charges
nothing, and a malformed video URL is refused the same way. What is **not**
free on this provider is an invalid parameter value — `?sort=banana` is ignored
and the page is billed in full, so the technique that makes its Reddit endpoint
list its own vocabulary does not work here. Read
`https://docs.scrapecreators.com/openapi.json` instead, at no cost.

It writes one whole video and a digest per search page rather than whole pages,
because this provider returns raw TikTok and a page of thirty is 1.8 MB. The
script says why, beside `digestOf`.

The ScrapeCreators YouTube capture is the same shape and spends 8 credits. Its
fixtures are stored whole, unlike the TikTok ones, because this endpoint
answers in a shape the provider designed and a page of twenty videos is 15 KB.
Two of its calls answer questions that cost money to get wrong: `includeExtras`
is what turns a 68-character title into a 1,400-character description **and**
what replaces a computed `publishedTime` with the real `publishDate`, and the
transcript endpoint charges a credit a video and returns thousands of
characters where TikTok's returns null. Run it when a YouTube connector is
written, and read `docs/sources.md` before trusting `uploadDate` — it narrows
and it leaks.
