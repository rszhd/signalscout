# Instructions for AI coding agents

This file is the single source. `CLAUDE.md` imports it, so Claude Code and
Codex read the same rules.

SignalScout finds public conversations from people describing a problem your
product solves. Read [PLAN.md](PLAN.md) for the product and
[STACK.md](STACK.md) for the stack before proposing anything structural.

**The pipeline works end to end, and US-022 ran it.** On 2026-09-05 one
monitor went from the form to fifty collected posts, twenty scored matches and
five verdicts, all live. US-001 built the
skeleton: four packages, Postgres with `pgvector`, migrations, the queue, and a
page that proves the bundle is served. US-002 added the four tables. US-003
settled the `SocialSource` interface and shipped a fake connector. US-005 added
the real Reddit connector, through Bright Data. US-007 added the scheduler, so
a monitor is polled on its own interval and the posts are stored. US-009 added
the classifier, so a post is now scored against a monitor and a match is
written when it clears the monitor's `min_score`. BUG-001 made the poll finish
what it starts: an asynchronous collection is remembered in
`source_continuations` and resumed, rather than triggered again. US-010's
server half added the query generator, the monitor writes and the routes, so a
monitor is now an HTTP call rather than an `INSERT`. US-011 added the inbox, so
a match is read back out, ordered by score and age together. US-013 added the
budget guard, so a poll is refused before it spends past a monitor's monthly
cap, and every billed page is written to `api_usage` as it comes back. US-014
added the cost test, so the monitor form runs each query once against a small
sample and says what a month of it would cost before the monitor starts.
BUG-002, found by that test's first live run, stopped a seven-day window being
bought as a month. US-008 added the pre-filter, so a post now has to match a
word or a subreddit, and then clear a similarity threshold, before the model is
paid to read it — and its embedding calls closed US-013's last box, so the
spend a cap counts is now every kind of call. US-012 added the feedback loop's
first half, so a match is marked good or not relevant, the verdict is kept as
history against the version of the monitor it judged, and a dismissed match
leaves the inbox without leaving the database. US-022 then ran the whole path against real
providers, and fixed the bug it found: a `PATCH` that carried one setting
erased every field it did not carry, because the body schema filled the absent
keys with its own defaults. US-016 added SMTP digests, optional immediate email alerts and signed
webhooks. Delivery state survives restarts in Postgres. Nodemailer has sent
through a local TLS SMTP receiver; Resend inbox delivery and a third-party
webhook receiver remain unproven. Read docs/notifications.md for setup. US-004 added the encrypted credential store, so
a key can live in the database rather than in `.env`, and US-023 added the
screen that writes one: a key is tested with the provider before it is stored,
and a key the provider refuses is never stored. That closed US-010's last box. `apps/web` has four
screens: the monitor form, the inbox, the monitor list and connections.

**A real credential has been stored, tested and read back.** On 2026-09-05
US-023 built the connections screen and ran it against Bright Data. US-024 then
re-keyed that row from `reddit` to `brightdata`, and rehearsed the migration
against a real database: a key stored the old way came back readable through
the new code, with nobody retyping it. A wrong key
was refused in 1.3 seconds, a `PUT` carrying it wrote no row, and the real key
was accepted in 1.4 seconds and stored encrypted — hint `••••b3e7`, ciphertext
93 characters, and no row anywhere containing the plaintext. Then the process
was restarted with `REDDIT_API_KEY` unset, so the database held the only copy,
and a test with an empty body decrypted the stored value and Bright Data
accepted it. Paste, test, encrypt, store, boot-check, decrypt, provider
accepts: proven end to end, on one source.

Five probes billed nothing. `api_usage` recorded no row for any of them, which
is the free-check claim measured rather than argued.

One thing stays unproven: no real browser has rendered the screen — it is
driven through jsdom only.

One consequence bites on any machine that has stored a credential: the process
refuses to boot without `ENCRYPTION_KEY`. That is US-004's check working as
documented, and it means a process started before the key existed must be
restarted.

**A key is tested where it is pasted, not where it is used.** The connections
screen calls `SocialSource.validateCredentials` before it stores anything. The
screen is keyed by provider since US-024, so one card is one account and one
rotation. On
Reddit the probe is free: an empty input list cannot start a collection, so a
bad key is refused at 401 before the input is read. A refusal and an unreachable
provider are different answers — 200 with `valid: false` and the provider's own
sentence, against 502 — because they lead to different actions. Read
docs/secrets.md, *Testing before storing*.

**Neither platform is reached through its own API.** Reddit ended self-serve
app registration in November 2025. X's own API is pay-per-use with no free
tier, and on 2026-09-05 the owner decided not to use it. Both platforms are
reached through data providers. Reddit runs through Bright Data and
ScrapeCreators; **X runs through SocialCrawl**, which US-006 added because
neither of the other two can search X — Bright Data's X dataset discovers only
by profile, and ScrapeCreators has no X search endpoint at all. $0.005 per read
is X's own price and it travels to nobody else. Read STACK.md, *A source is not
a provider*, before touching a connector: the interface does not change to suit
a provider.

**A platform and a provider are separate things.** US-024 split them on
2026-09-05, because two providers will fetch Reddit and they agree about
neither the price nor the key. A *platform* is what a person ticks — it keys
`posts.source` and deduplication, and a monitor names it. A *provider* is who
fetches, whose key it is, and what it bills. A *connector* is the pair, and it
is what the registry holds. Six columns carry the provider beside the platform:
`api_usage`, `source_continuations`, `posts` (attribution only, and outside the
deduplication key), `source_credentials` (keyed by provider alone),
`query_estimate_probes` (a sample holds a cursor, so it belongs to the provider
that took it, and its price comes from the pair) and `source_providers`
(US-026's store of who fetches what). An environment variable is named after
the provider — `BRIGHTDATA_API_KEY`, with `REDDIT_API_KEY` read as a deprecated
fallback — and the connections screen is keyed by provider too, because one key
serves every platform behind it.

The split changed no behaviour, and the suite is the evidence: no expected value
moved except the ones the ticket asked to move. What it did not do is run live.

**Reddit has two providers, and one live poll has run through each.** US-025
added ScrapeCreators on 2026-09-05. It is a different shape from Bright Data in
every way except the interface: the API is synchronous, so a search returns its
posts in 1.8 to 4.9 seconds and the connector never waits on a snapshot; it
bills a *request* rather than a record, and reports `credits_charged` on every
answer, so `unitsConsumed` is measured and not assumed. A subreddit page cost
$0.075 through Bright Data and $0.00376 through ScrapeCreators.

Three of its facts were not in the provider's documentation, and the capture
script found all three: a `timeframe` is refused beside `sort=new`, so `since`
is applied by us; a subreddit that does not exist answers 200 with an empty list
and bills a credit for it; and the credential probe is free, measured against
the account's own credit balance and against `api_usage`, which held no row for
it.

**Deduplication across two providers is proven, live.** A ScrapeCreators poll
collected 47 posts from a subreddit Bright Data had already collected, and
stored no new row. Both connectors read Reddit's own `t3_` fullname —
`post_id` at one provider and `name` at the other — and `posts` is keyed by
`(source, external_id)` with the provider outside the key.

What is still unproven for this connector: a real rate limit, a real timeout,
and keyword discovery at any volume. The 429 branch is our half of a contract
the provider has not yet shown us.

**A person chooses which provider fetches a platform, and the common
deployment is never asked.** US-026 closed on 2026-09-05. A monitor names a
platform and its row records no provider, so `registry.only` decides, and
`decideProvider` is the one rule it and every screen read. The order is: a
recorded choice that can run wins; a recorded choice that cannot run is refused
rather than replaced; one provider that can run is its own answer; two that can
run and no choice is an error. "Can run" means this deployment holds the key,
which is why a build shipping two Reddit connectors asks nothing of an instance
holding one. `source_providers` is the store, one row per platform, and no row
is the normal state. `REDDIT_PROVIDER` is gone.

Three things follow, and each has a test. The choice is read per poll, so a
change takes effect on the next collection with no restart. It never reaches a
collection already running, because `source_continuations` carries the provider
that started one and the poll resumes through that provider — a cursor is a
snapshot id the other provider has never heard of. And `api_usage` is keyed by
the pair, so a switch splits the month's spend across two rows rather than
pricing one account's month at the other's rate.

**The switch has been made live, mid-collection.** On 2026-09-05
`live:provider-switch` triggered a Bright Data collection of r/softwaretesting,
moved the recorded choice to ScrapeCreators one second later while the snapshot
was still collecting, and watched what happened. All four resumes went back to
Bright Data with Bright Data's own cursor
(`subreddit|sd_mto9lmkh1w5v9syrux|0`); ScrapeCreators was never asked. The
snapshot closed after 2 minutes 13 seconds with 50 records for $0.075. Only
then did the next collection go to ScrapeCreators: 47 posts for 2 requests and
$0.00376. `api_usage` holds two rows, one per provider, each priced by the
connector that ran.

Two numbers came with it. **The same subreddit cost twenty times less through
ScrapeCreators**, measured back to back rather than on separate days. And
**Bright Data's snapshot was ready in 2 minutes 13 seconds**, against US-022's
8 minutes 40 — so that figure is a sample and not a constant.

The whole run stored no new post. All 50 records and all 47 posts were already
in the table from earlier runs, and `posts` stayed at 174: deduplication across
two providers, again, live.

**Reddit has three providers, and the third is for precision rather than
price.** US-031 added SocialCrawl on 2026-09-06, on the key that already fetches
X, LinkedIn and YouTube. It is the expensive one — a credit is 8,118
micro-dollars against a ScrapeCreators request's 1,880 — and it exists for one
endpoint the other two do not have: `/v1/reddit/subreddit/search`, a keyword
*inside* a subreddit.

The capture measured why that matters. `flaky tests` across all of Reddit
returned 25 posts from r/TIdaL, r/RedditLaqueristaSwap, r/Euphoria_HBO, r/AskVet
and r/snapmaker — a watch app's audio was "still flaky with 3+ devices" and a dog
had a skin issue. The same words inside r/softwaretesting returned **7 posts, all
on topic and all from that subreddit**. That is the discovery mode US-022 showed
was missing.

So this connector inverts the usual order: scoped first where a monitor names
both a query and a channel, a bare subreddit sweep only where there is no query,
and the keyword-across-Reddit search only where there is no channel. It reads no
replies on purpose — its comment endpoint is 5 credits against ScrapeCreators' 1
for the same thread — and `canFetchReplies: false` is what tells the monitor form
to say so.

**TikTok is the fifth platform, and its leads are in the comments.** US-044
closed on 2026-09-06, the third crossing of PLAN.md's *Important rule* and
again on the owner's decision. The rule stands for the sixth. It runs through
SocialCrawl on the key that already fetches X, LinkedIn, YouTube and Reddit.

Two live runs and one comment run measured it. A search returned **60 videos in
6.7 seconds for 2 credits**, and three videos matched — people mid-routine
asking what to try next, each naming products they had already bought. Then 60
of the stored comments were read: **seven matched, and the top scored 82**
against the best video's 70. It is a person saying one moisturiser broke them
out, asking why, and naming a second to ask whether it would be better.

**The product decides whether this platform is worth polling.** The first
capture searched `flaky tests` and returned dandruff and school exams, because
here *flaky* means flakes and *test* means an exam — and the first conclusion
written from it, that TikTok cannot carry a lead, was wrong. It had measured a
QA product's audience, not the platform. A monitor whose customers must
describe a condition to get a useful answer finds them; one selling to
engineers does not.

Three facts follow for anyone changing this connector. **The pre-filter has
almost nothing to cut**: triage dropped 4 of 60 comments, where US-030 measured
20 of 26 dropped on a Reddit thread, because under a product-recommendation
video nobody is an expert answering. **Two of the seven matches are Spanish**,
scored correctly with English reasons — the first non-English classification
this product has made. And below about 60 the matches become "where do you buy
it", which is purchase intent for somebody else's product.

**Every comment link has been pressed, and one of the four was wrong.** US-047
opened one comment link per platform on 2026-09-06, in a signed-in browser.

| Platform | Where the link comes from | Result |
|---|---|---|
| Reddit | the provider returns it | opens the comment |
| X | the provider returns it, a `status` URL | opens the reply |
| YouTube | **we build** `&lc=` | opens it **highlighted** |
| TikTok | **we build** `?cid=` | opens the comment |

The two we build are the two worth watching, and TikTok's was broken until that
day. Signed-out behaviour is untested on all four.

**A TikTok comment does have a link, and it is `?cid=`** — the decimal comment
id in URL-safe base64 with the padding stripped, which is the format TikTok
puts in its own comment notification. The connector shipped `?comment_id=`
first, which it invented; the owner opened one and got the video. Then a link
built this way from a comment the pipeline had collected was opened and it
landed on the comment. **A URL format we invent is evidence about our own
string building and none about the platform** — the same rule that already
governs fixtures, and `?comment_id=` survived a capture, two live polls and a
code comment admitting it was a guess because nobody clicked it.

Still unproven for this connector: a rate limit, an outage, a second poll
proving deduplication of *comments* — the second video poll proved it for
videos, storing 14 new against 44 already held — and `?cid=` in a logged-out
browser, which nobody has tried.

**Instagram is the sixth platform, and it is the dearest place to read a
comment.** US-049 closed on 2026-09-06, the fourth crossing of PLAN.md's
*Important rule* and again on the owner's decision. The rule stands for the
seventh. Threads is the last of US-038's three and is still parked. It runs
through SocialCrawl on the key that already fetches X, LinkedIn, YouTube, Reddit
and TikTok.

**Its two halves are priced ten places apart.** A reel search is 1 credit for 30
reels — the cheapest search this product makes. A comment page is **5 credits
for 15 comments** — the dearest. The lead here is in the comments, as on YouTube
and TikTok, so everything worth reading is behind the expensive endpoint. The
connector declares `replyPricePerUnitMicros` separately for the reason US-028
found on LinkedIn: where a request and a credit are different numbers, a guard
fed the wrong one lets a monitor spend five times its cap.

**The comments are also shorter, measured against TikTok on the same kind of
thread.** US-044's acne moisturiser video ran a median of 54 characters with 22
of 49 over sixty. An Instagram skincare reel ran a **median of 26 characters,
with none of 29 over sixty**. Half the words at five times the price. That is
one thread each and not a distribution, and it is enough to tell somebody
ticking this box to expect a higher cost per lead than either video platform
beside it.

**Three of the provider's own claims were wrong, and the free catalogue was
right about none of them.** A search with **no date window returns five years**
— thirty results ran 2021 to 2026 and the newest was five months old, so a
monitor's `since` would discard everything it was billed for, every poll. This
is therefore the one connector that always sends a window, where LinkedIn
deliberately sends none in the same case. **`has_more` came back true beside a
page of zero items**, with a fresh cursor pointing at more nothing, so the walk
ends on an empty page rather than on the flag. And **`url`, `post_id` and
`author.display_name` are null on every comment** — 29 of 29, against 137 from X,
YouTube and TikTok that fill all three. The shared parser now falls back to the
handle for a name, and **BUG-007's wrong-parent check is inert on Instagram**:
there is no `post_id` to disagree with.

All three were free to discover. The empty page was refunded, and so was the
refused key.

**The live poll ran, and it answered the platform's question yes.** 20 reels and
89 comments collected; the first run then spent its whole cap on the provider
before the classifier read a single comment, so its zero matches measured the
budget rather than the platform. Read afterwards on credit already spent,
**five comments matched at or above 50 and the top scored 90** — the highest any
comment has scored on any platform here, against TikTok's 82. It is a person
whose skin barrier retinol destroyed, asking how to treat acne scars safely,
which is the monitor's own problem statement said back to it.

**The leads are entirely in the tail, so a median describes this platform
badly.** Of 89 comments, 56 were under ten characters and the median was four;
twelve passed sixty, and **the two best matches are the two longest comments in
the run**. About one comment in seven carries words, and that seventh holds
every lead. The first version of `platforms.ts` read this as a poor platform and
was corrected: it is sparse and dear, not poor.

**Triage keeps 86 of 89 here**, the weakest cut yet — against 4 of 60 dropped on
TikTok and 20 of 26 on a Reddit thread. Under a product-recommendation video
nobody is an expert answering, so the stage costs more than it saves and the
argument for it is a Reddit argument.

Still unproven for this connector: nobody has opened one of its comment links,
and the hashtag search was never called — the capture ran lean at 13 credits and
left that question open. `--lean` is the flag; running it without one answers
both remaining questions.

**LinkedIn has two providers, and the second one was chosen for freshness
rather than price.** US-057 added HarvestAPI's actor on Apify on 2026-09-07,
after US-056 measured three providers for one platform and US-055 built and
dropped one of them.

**Every post the measurement returned was under ninety minutes old** — ten
posts across a 71-minute page. ScrapeCreators' newest was three days old and
SocialCrawl orders by relevance across weeks. That is the number this connector
exists for, and it is not the cheap one: fifty posts cost **$0.10** on a free
Apify plan, against $0.0094 through ScrapeCreators and $0.2030 through
SocialCrawl.

**Apify is a marketplace, not a data API.** What we call is one actor somebody
else publishes, so the actor can change under us without the API changing at
all — a reason to re-run the capture rather than to trust a fixture for ever.
The credential field is `apiToken`, which is what makes
`environmentVariableFor` produce `APIFY_API_TOKEN`; a field called `apiKey`
would have silently asked for a variable nobody sets. `logger.ts` redacts
`apiToken` too, and the leak test is what caught that it did not.

**The bill settles after the run ends, and that is the trap.** A run that had
just returned ten posts reported `usageTotalUsd: 0.00005` — its start event
alone — and $0.02005 a few seconds later. A budget guard fed the first number
would price every poll at five thousandths of a cent and refuse nothing, for
ever, silently. `client.ts` waits for the total to stop moving, and
`unitsConsumed` is that total divided by the price of a post rather than the
item count: a run that matches nothing returns no posts and still costs
$0.00105.

Three more measured facts. **`sortBy: "date"` selects recent posts but does not
order them**, so no page may be read as older than the next — the same
early-stop rule that is absent from the SocialCrawl LinkedIn connector, absent
here for a different reason. **The id is the activity id**, the same number
SocialCrawl returns, so the two providers deduplicate against each other. And
**the run is asynchronous**, 3 to 11 seconds, so the run id travels in the
cursor: a resumed poll that started a second run would buy the same posts
again, which is BUG-001's lesson at a per-post price.

**One live poll has run, and the freshness claim now has worker evidence.** On
2026-09-07 a monitor with the query `flaky tests` collected **25 posts in 13.1
seconds** through one wait and one resume, billing **26 units, $0.052** — the
posts plus the start event rounded up into a whole post. In `posts` the two
LinkedIn providers now sit side by side: Apify's 25 run from **3.0 hours to 33
minutes old**, SocialCrawl's 20 from 543 hours to 50. Twenty-two days against
three hours.

**That poll found a bug the whole suite could not.** `apify` was not in the
database's provider enum, so nothing the connector collected could be stored,
and 1,228 tests passed anyway: `assertSourcesCanBeStored` checks platforms and
**nothing checks providers**. Migration 0039 adds it. A connector can be
registered, tested and unable to write a row.

**Two matches came out, both at exactly 50, and neither is a lead.** One is a
retry-policy tip ending in an engagement question; the other opens "Brittle
tests killing your sprint velocity?" and links to an article. US-028's finding
stands and a fresher provider does not touch it: **a fresh page of thought
leadership is still thought leadership.**

Still unproven: the window. `postedLimit` was sent and could not be shown to
narrow anything, because a week cannot narrow an answer that is already 71
minutes wide. Its seven values come from the actor's input schema, where its
store page lists four. Comments are available on the same actor at the same
price as a post, with a `commentsPostedLimit` filter no other provider here
offers — and nothing has measured whether a LinkedIn comment carries a lead, so
`canFetchReplies` is false.

**One LinkedIn provider was built and dropped without shipping.** US-055 wrote
the ScrapeCreators connector, passed 34 tests, and stopped: that endpoint finds
posts through Google's index and then scrapes them. US-054 had measured
freshness and not coverage — it proved a one-day-old post was findable and
never asked how many matching posts the index never held. The work is in a
named stash. Three of its findings outlive it: the activity id read out of a
post URL, a 404 `not_found` that means an empty page, and that
**`builtInSources` order is the order every screen shows platforms in**,
because `groupByPlatform` keeps registration order.

**LinkedIn is the third platform, and PLAN.md said not to add one yet.**
US-028 closed on 2026-09-05. The rule at PLAN.md's *Important rule* is that no
third network is added until Reddit and X reliably produce useful matches, and
that condition is not met: X has one poll and five verdicts behind it. The
owner decided to add LinkedIn anyway. It is written here, in STACK.md and in
the ticket so the next reader finds a decision rather than an oversight, and
the rule still stands for the fourth.

It runs through SocialCrawl, on the same key as X — the first time one provider
fetches two platforms, which is what `ProviderDescriptor` was split out for. A
person pastes that key once and rotates it once. **Sharing a key is not sharing
a contract**: the capture asked the LinkedIn endpoint all nine questions, and
four answers contradicted X.

One call costs **five credits and returns ten posts**, where X is one credit for
twenty — so a LinkedIn post costs about $0.0041, ten times an X post and
twenty-seven times a Bright Data Reddit record. The connector therefore counts
**credits, not requests**: at five to one the two words are different numbers,
and a guard fed the wrong one lets a monitor spend five times its cap. One
query polled hourly is about $58 a month.

Three measured facts break rules the X connector relies on. The answer is
ordered by **relevance, not date** — a captured page ran 22 August, 22 August, 4
September, 31 August, 15 August — so X's "the whole page is older than `since`,
stop paging" rule is wrong here and is deliberately absent. The window is a
`date_posted` parameter with three fixed values and nothing finer, so the
connector asks for the narrowest window covering `since` and makes the exact cut
itself. And **a search that matches nothing is billed in full and does not come
back empty**: a phrase that cannot occur returned ten unrelated posts and
`total: 98`. A vague query here is full-price noise, not free silence.

The documentation was wrong about pagination — it describes none, and page two
came back with ten posts and none of page one's among them. It is also quiet
about caching: the same query sent twice was flagged `cached: true` and cost
zero. Nothing counts on that, because the window is undocumented.

The first capture run corrected itself before anything was committed. The
scrubber let real names and job headlines through, because it decided what a
person was by sniffing for fields this provider does not use. **Read the
fixtures your own script wrote before committing them.**

**One LinkedIn poll has run through the worker.** On 2026-09-05 a monitor with
the single query `flaky tests` collected **20 posts in 2 pages for 10 credits**,
in 3.6 seconds. `api_usage` holds one row for the pair, 81,180 micro-dollars,
which is 10 × the connector's own price. The pre-filter dropped none of the
twenty — the third platform where that has been measured, and the same reason
each time: a search that already matched the words leaves no cheap stage before
the bill. Five matches came out, 69 down to 54.

**LinkedIn's noise is a different kind.** The top match is a direct question
about handling flaky tests in CI. The bottom two are articles *about* flaky
tests, written to be seen — and the classifier scored them 55 and 54, only
fifteen points below the real question. Reddit keyword search produced
off-topic noise, which a pre-filter can catch. This is on-topic
expertise-signalling, which it cannot. Say so before anyone reads five matches
as five leads.

**A real model timeout happened here, and it is the first one.** One of twenty
answers was aborted on timeout, recorded as `failed`, no match written, the
post kept its place, and the other nineteen finished. With US-006's malformed
answer, that is two of the classifier's three failure paths proven live. A real
rate limit is the one left.

Still unproven for this connector: a real rate limit, a real outage, and a
second poll proving deduplication on LinkedIn. Channel discovery is
unimplemented on purpose — `from_member` and `from_company` are documented
without saying whether they take a URL, a slug or an urn, and a wrong guess
costs five credits to learn nothing.

**X has two providers, and the second exists because one was a single point of
failure.** US-061 added SocialData on 2026-09-07. Until then every X poll this
product made depended on one account at one company, and nothing measured what
happened when that account was refused.

**The window goes to the provider, and that is the reason rather than the
price.** `since_time:` inside the query takes a UNIX timestamp and it works: a
24-hour window returned **7 tweets for $0.0014** where the same query
unwindowed returned **20 for $0.0040**. `socialcrawl/x.ts` has no window at all
— it buys everything older than `since` and discards it here. This is the only
connector in the product that stops paying for what it will throw away.

It is also half the price: **200 micro-dollars a tweet** against SocialCrawl's
406, so fifty posts cost $0.0100 against $0.0203. It bills the **tweet**, not
the request — twenty tweets moved the balance $0.0040 and seven moved it
$0.0014 — so a connector counting requests would let a monitor spend twenty
times its cap.

**`type=Latest` really orders newest first, measured across a whole page**, so
the early-stop rule rests on a measurement rather than on a documented claim.
The id is the bare tweet id, the same number `socialcrawl/x.ts` reads, so the
two providers deduplicate against each other. There is **no URL field**: one is
built as `x.com/<handle>/status/<id>` and US-060 opened one — it lands on the
post, and it is the same string SocialCrawl returns.

**This provider is prepaid, which no other one here is.** An empty balance
answers **402**, which is not a wrong key and not a rate limit: retrying will
not help and the repair is on the provider's website. `SocialDataError` gives it
its own kind, and `validateCredentials` probes the free balance endpoint rather
than a search — so a person with an empty account is told to top it up rather
than to replace a key that is fine.

**The key can contain a pipe character.** An unquoted `SOCIALDATA_API_KEY=…`
line makes a shell run the second half as a command and load an empty key,
which looks exactly like a missing one. `.env` must quote it.

**One live poll has run, and the window is proven in production.** On
2026-09-07 a monitor with a 24-hour `since` collected **7 posts in 2 pages for
$0.0014**. Two pages without a window would be forty tweets and $0.0080, so the
window **cut the bill by 82%**. The seven posts run from 19.8 hours old to 87
minutes; SocialCrawl's forty, collected without a window, reach back 4.8 days.

**Its recorded cost matched the provider's own balance to the micro-dollar** —
`api_usage` holds 1,400 and the account moved $0.0014. That is the second time
a figure in that table has been checked against a provider's own number and the
first time it matched exactly; Bright Data's day was 3.2% high.

The poll found zero matches. Six posts mentioning flaky tests in one day on X
is a thin sample of a narrow query, and it says nothing about the connector,
which returned what it was asked for.

**Deduplication is proven, and the cost matched twice.** A second poll of the
same query collected 8 posts, billed 8 units, and stored **1 new** — seven were
already held, and the one new row is a tweet written between the two runs.
`api_usage` matched the account's own balance to the micro-dollar on both polls.

**An empty search is free only inside the free allowance.** The capture read
one and the balance did not move; twenty-five fired back to back cost $0.0044,
which is 22 charged at $0.0002 and 3 free — the documented three requests a
minute. SocialCrawl refunds an empty X search outright, which is the one place
the incumbent is cheaper. **One call inside a free allowance measures the
allowance, not the price.**

Still unproven: a real rate limit — twenty-five back-to-back searches all
answered 200, so the limit is above that rate and trying without triggering one
is not evidence there is none — and a real 402, which is not worth forcing
because it costs the whole balance. `canFetchReplies` is false because nobody
has measured the provider's comment endpoint or whether its links open.

**X had one provider, and the reason was that only one of three could search
it.** US-006 added SocialCrawl on 2026-09-05. Bright Data's X posts dataset
answers a discovery trigger with `Available types: profile_url,
profiles_array`, and ScrapeCreators publishes six X endpoints and no search
among them. Both fetch the posts of an account you name; neither finds a
stranger describing a problem. Both refusals came from the providers' own APIs,
not from their documentation, and both probes were free.

SocialCrawl bills a request and refunds one that matches nothing — measured
twice, at `credits_used: 0`. A request carried 20 posts, so an X post costs
about $0.0004: cheaper than a Bright Data Reddit record, and about one
thirtieth of X's own API. Its price is the only one here that carries an
exchange rate, because the provider bills in pounds.

Its capture answered four things the documentation did not. The cursor is at
`data.next_cursor` *and* at `pagination.next_cursor`, and the two strings
differ. `sort` takes `latest` or `top` and the documentation names only `top`.
A search that matches nothing is free. And **an empty answer is not always the
truth**: the same query returned nothing at 20:12 and twenty posts at 20:31,
both free, so no empty page may be read as a query being finished for good.

One product finding came with it, and it is not about the connector. On X a
long generated phrase is useless in both directions: unquoted, `end to end
tests keep breaking` returned anime, Bitcoin and a CIA story across three
weeks; quoted, it matched nothing at all, twice. The two-word `flaky tests`
returned twenty posts that were all on topic. US-027 is the fix, and it is
described below.

**A query is now written for one platform.** US-027 keyed the queries by
platform on 2026-09-05: `monitors.generated_queries` holds one list per
platform, the generator is told which platforms a monitor watches and writes a
list for each, and the poll hands a connector its own list and no other. A
`PlatformDescriptor` carries the rule — four words on X, eight on Reddit — and
one number is enforced everywhere a query is written or edited: the model's
schema, the API, and the form. The prompt gives the reason beside the number,
because a model told only a limit talks itself out of it.

Migration 0021 keyed every existing row by the platforms its monitor watches,
and it ran against the development database: six monitors, every query kept,
nothing rewritten. A monitor that names no platform keeps its array and still
polls, and both worker steps read that older shape.

**The new prompt has met a model and its query has met X.**
`capture:queries` ran again on 2026-09-05: every X query it wrote is four words
or fewer and every Reddit query eight or fewer, for 733 input and 540 output
tokens. Then `capture.mjs --only=generated` took the first X query out of that
plan — `UI changes break tests` — and searched it live: **6 posts for 1 credit
in 5.6 seconds, three of them on topic**, about tests glued to a CSS class,
brittle selectors and teams failing to keep tests alive.

Read that number carefully. It says a generated four-word query finds real
people describing the problem, at about half a page. It does not say the seam
is wide: the hand-written `flaky tests` returned twenty posts inside three days
where this one returned six across six weeks. **Precision and volume are two
measurements and only the first has moved.**

One cost note came with it. The model wrote eight X queries, which is the
ceiling, and eight queries at two pages each is up to sixteen credits a poll.

**One X poll has run through the worker.** On 2026-09-05 a monitor with the
single query `flaky tests` collected **40 posts in 2 pages for 2 credits**, in
12.4 seconds. `api_usage` holds one row for the pair, 16,236 micro-dollars,
which is the connector's own price and not an assumption. The pre-filter
dropped none of the forty: they all came back from a search for those words, so
every one bought a model call — the same cost fact US-022 measured on a
subreddit. Two matches came out, at 66 and 53, both people asking whether
something handles flaky tests.

**An X thread with no replies is not free, and it does not answer empty.**
Measured on 2026-09-06: `/v1/twitter/tweet/replies` on a post with 28 replies
returns 28 correct ones, and on a post with none it returns **one unrelated
recent post** — a different one each call — for one credit, with a cursor
inviting more. The item's `post_id` is its own id, which is the signature of a
top-level post rather than a comment. The refund this file records for X
*search* is a property of that endpoint and does not travel here. BUG-007 is
the parser's defence: a comment whose `post_id` is not the post asked about is
dropped.

Still unproven for this connector: a real rate limit, a real timeout, a real
outage, and a second poll proving deduplication on X.

**The embedder has met a real provider once.** On 2026-09-05
`capture:embeddings` embedded PLAN.md's example monitor and the five fake posts
with OpenAI's `text-embedding-3-small`, for 176 tokens. The provider path, the
key fallback, the 1,536-number width and the cost recording are proven for the
happy path. The failure paths are not: a real rate limit, a real timeout and a
real refusal have only been simulated.

That run also measured the threshold. The four on-topic posts scored 0.26 to
0.57 and the sourdough post 0.09, so the default of 0.15 sits inside a gap of
0.18, and `ai/similarity.test.ts` replays those numbers and goes red if it
leaves. **That is one monitor and five posts, not a distribution.** The
`filter_drops` rows are the instrument that moves it next.

One thing follows for a deployment: Anthropic — our default model provider —
publishes no embedding endpoint, so the common install runs the free keyword
stage and sends everything it keeps to the model until `AI_EMBEDDING_PROVIDER`
names something else. On OpenAI it needs nothing: the embedding provider, model
and key all fall back to the ones the classifier uses.

**The embedding stage does not fit a comment, and that is measured.** US-029
closed on 2026-09-06. It embedded all 21 comments of one real
r/softwaretesting thread against PLAN.md's example monitor, two ways. Under the
parent post's title every comment lands within 0.08 of the title's own 0.4187,
so nothing is dropped at any threshold and the stage is a pure cost. Alone the
comments do separate by subject, but the gap is **0.0103 wide** against the 0.18
measured on posts, and it sits at 0.22 where the shipped threshold is 0.15.

The number that settles it is neither of those. **The highest similarity in the
thread, 0.5504, is nine hundred characters of expert advice** — higher than four
of the five posts in `similarities.json`. The stage measures subject, and under
a relevant post the experts answering are on subject too. So a comment will go
from the free keyword stage straight to US-030's triage model: one paid stage in
front of the classifier, not two.

That first run had a hole in it: **zero of its 21 comments was a person
asking**, because under a post that requests advice everybody underneath is
answering it. So the two classes were never weighed, and the decision rested on
two indirect readings.

**The second thread closed that hole, and the answer did not move.** The same
instrument ran on 2026-09-06 against a *statement* post — "Playwright is
significantly better than Selenium", 25 comments — chosen because an opinion
post draws people describing problems of their own. Four are asking, and one of
them is the shape this product exists to find: a person testing a native
Android app who asks for alternatives.

**No threshold separates asking from answering, in either setting.** That is
now measured and not inferred. The highest score in the thread, 0.5681, is an
expert answering about Safari and WebKit; the real asker sits seventh at
0.4377, and two other askers sit at the bottom on 0.1898 and 0.1215.

Two further facts came with it, and both harden the decision. At the shipped
threshold of 0.15 the comment-alone setting **drops an asking comment** — 0.1215
— which is the silent false negative the stage was suspected of. And thread
one's 0.0103 subject gap did not reproduce at all: here the lowest topical
comment scores 0.1215 against an off-topic 0.2688, so that gap was noise and not
a narrow signal. Under the parent title, 25 of 25 are kept inside 0.2 of the
title's own 0.3892 — the same pure cost as before.

Both threads and both label files are committed, and
`capture:comment-filter statement-post` re-runs the second.

**A deep thread is read fifty comments at a time, and stops when a batch holds
no lead.** US-048 closed on 2026-09-06. A thread of a hundred thousand comments
is $297 of classification if nothing stops it, and the reply step had only a
page bound — four pages, which is 100 comments through one provider and 204
through another, a difference nobody chose.

Reading is a **loop across the pipeline**, because the decision needs verdicts
that do not exist until a batch has been classified. `replies` buys fifty,
`filter` and `classify` judge them, `classify` hands the thread back, `replies`
decides whether to buy more. The rule lives in `replies.ts` alone: `classify`
says only that these threads have been judged. Five columns carry the walk
between jobs, since it now outlives one, and `replies_judged_to` is the seam —
the judgement covers the range it and `replies_batch_start` bound, which is the
batch bought last time and scored since.

**The first version judged the batch it had just bought**, which nothing had
scored yet. It counted zero every time, so every thread would have died after
three batches however good it was. A live run found it; the suite could not,
because every case drove one batch per job and two batches never met.

**Leads sit deeper in a thread than the platform's own ranking suggests, and
that is measured.** On one TikTok thread of 1,713 comments, positions 0-49
matched at **10.2%** and positions 400-449 at **30.6%** — three times the rate,
p = 0.011. A platform ranks a comment for engagement and this product wants
intent, and a question collects no likes, so questions sink. The first draft of
US-048 assumed the opposite and was corrected before it was built. Only YouTube
offers an ordering that would sidestep this (`order=newest`, asked for since
US-034); TikTok, X and SocialCrawl Reddit have no sort at all, and
ScrapeCreators' Reddit `sort` is understood and broken — it returns zero
comments and bills for them.

**One live run, and it stopped on the budget.** `live:thread-loop` drove four
batches over a 642-comment thread, read to position 238, found six matches and
stopped at $0.6032 of a $0.60 cap. It also found that a budget refusal recorded
no reason at all, so a short thread read as a judgement about the conversation
when it was a judgement about the month.

Two facts belong beside any reading of a stopped thread. **A batch is not
fifty**: the walk buys whole pages until it holds fifty and overshoots, so the
batches in that run were 50, 93 and 95 comments — which makes an empty batch
stronger evidence than fifty would. And **the classifier is not deterministic**,
so the threshold is a sampling decision: the same fifty comments produced one
match on one run and two on the next. A thread near the boundary can be kept on
one poll and dropped on the next.

**A cheap model now reads everything before the good one does.** US-030 built
the triage stage on 2026-09-06. It is the pre-filter's third stage, it asks one
question — could this author be a person to reach? — and it answers in one word
with no reasons, because output tokens are priced about five times input and a
classification spends 95 of them. It runs inside the filter step's `pass`,
which is where all five of that step's exits go, so no exit can forget it.

**Only an explicit `no` drops.** A timeout, a refusal, a malformed answer, a
rate limit and an unreachable provider all pass the item on. This stage decides
what the classifier never reads, so its failure is a lead deleted with no row,
no inbox entry and nothing anyone would notice — the same asymmetry the
embedding stage is built on, and sharper here because there is no threshold to
inspect afterwards.

`AI_TRIAGE_MODEL` and its four companions fall back to the classifier's, so a
deployment that sets nothing still gets the stage on the model it already has.
The price does not fall back once a triage model is named: a cheap model billed
at the classifier's rate would report a saving that did not happen.

**It has met a real model, over 46 hand-labelled comments, and the numbers
reversed the ticket's premise.** `capture:triage` asked `openai/gpt-5.6-luna`
about every comment US-029 labelled, plus PLAN.md's four worked examples: fifty
calls, 29,999 input and 6,135 output tokens, **$0.013360**. It kept 19 of 46
comments, dropped 20 of the 26 people answering, and kept all three worked
examples PLAN.md scores as leads.

**A one-word answer is not a cheap answer.** The stage was built on the idea
that most of the saving is the short output. It is not: this model bills its
own reasoning as output, so a triage answer cost **113 output tokens against a
classification's 95**, and 267 micro-dollars against a classification's 250 on
the same model. Triage is dearer per call than the thing it avoids.

**So the whole saving is the price gap, and with no gap there is a loss.** Over
those 46 comments: with `gpt-5.6-terra` classifying, triage takes the bill from
$0.1150 to $0.0598, which is 48% off. With `gpt-5.6-luna` on both stages — this
repository's current `.env` — it takes $0.0115 to $0.0170, which is 48% **more**.
The worker warns at startup when the two models match. It warns rather than
refuses, because the stage still keeps the experts out of the inbox and because
a local model makes the money argument moot.

OpenAI's published prices are in `provider.ts`, read 2026-09-06: luna $0.20 and
$1.20 per million tokens, terra $2.00 and $12.00, sol $4.00 and $20.00.

**US-032 then made the gap real.** This repository classifies with
`gpt-5.6-terra` and triages with `gpt-5.6-luna`, ten to one on output, which is
the pair US-030 measured at 48% cheaper. The two captures were re-run against
terra for $0.018: it scored PLAN.md's four worked examples **10, 70, 84 and 93**
where luna scored 7, 64, 86 and 96. The order holds, and the gap between the
drop and the first match widened from 57 points to 60, so `defaultMinimumScore`
stays at 30 and now sits in a wider gap. Terra is the stricter reader at the top
and the more generous one at the bottom. Every query in the new plan is inside
US-027's per-platform word limit, and no test assertion moved: every terra score
landed in the band luna's had.

**The shipped default still has no gap.** `.env.example` names
`claude-haiku-4-5` and `provider.ts` carries nothing cheaper, so a deployment
that keeps the default triages on the same model and pays for the stage. The
worker warns, `.env.example` explains it, and changing the default is a product
decision nobody has made.

Three findings travel with it. The model is not deterministic: the same fifty
items captured twice the same evening kept 21 comments and then 19, so the
replay test asserts bands rather than exact counts. It refused one of the four
people asking — the same one both times — and that one asks for a way to test a
**native Android app** while the monitor sells a browser test runner — so the hand label and the verdict disagree for a reason,
because `asking` answers "is this person asking?" and triage is asked "could
this be a person to reach?". The instrument claimed those were the same question
on its first run and was corrected. And 10 of 16 jokes and notices survived,
including a `[deleted]` body and a moderator's vendor-spam notice: the stage is
lenient on noise and firm on experts, which is the safe direction and the next
thing to attack. Two threads and one monitor is not a distribution.

**The classifier has met a real model, and its fixtures are current.**
`capture:classifier` ran on 2026-09-05 against the system prompt US-010
shipped, and recorded 7, 64, 86 and 96 for PLAN.md's four worked examples,
whose intents are 3, 50, 90 and 96. The order holds and the gap between the
drop and the first match is 57 points. `ai/examples.test.ts` replays those
answers.

**Two failure paths are now real.** In US-006's live X poll, one of forty answers
came back as broken JSON: an unterminated string with two Hebrew characters
spliced into a reason. It was recorded as `rejected`, no match was written, the
post kept its place and the poll finished. So a malformed answer is proven
handled. A real rate limit and a real timeout are still only simulated.

That run also showed a hole worth remembering: the error said only "response
did not match schema", which names nothing a person can act on. `call.ts` now
carries the schema's own complaint into the message, truncated.

US-028's live LinkedIn poll added the second: one of twenty answers was aborted
on timeout, recorded as `failed`, with no match written and the post keeping its
place. **A real rate limit is the last simulated one.**

**A post is scored once per monitor, per version, and until BUG-003 it was
not.** The skip asked whether the post had a row in `matches`, which is a
different question: a post scored below the monitor's `min_score` writes no
match, so nothing the skip read recorded the work. On the development database
77 of 230 pairs had been classified twice. The skip now reads the call ledger,
and `model_calls.monitor_version` says which question each answer answered — a
post scored under version 1 has not been asked version 2's. A check constraint
refuses a classification without a version, because a writer that forgets one
pays twice in silence.

That bug had a second half, and it is worse than the money. Three of the
repeats produced a match: the first call scored the post under the threshold
and the second, minutes later, scored it 51 to 53 against a `min_score` of 50.
**A post near the threshold got an answer per poll, and reached the inbox on
the poll that happened to round up.** The inbox was not reproducible.

**The query generator has answered once.** `capture:queries` ran on the same
day and `ai/fixtures/query-plan.json` holds the plan it wrote — seven queries
and five subreddits for the example monitor. The seven are seven angles and
not one query written seven ways. All five subreddit names exist: four were opened by
hand, because Reddit answers 403 to an unauthenticated request, and
`softwaretesting` was proven by a collection that returned fifty posts from
it. What the plan is not proven to be is *useful* — a name that exists can
still be the wrong place to look.

**This instance has a login, and one account.** US-017 shipped on 2026-09-08
and is held in `doing/` with one acceptance box open — the credentials one,
deferred for the reason four paragraphs down. Better Auth, email and password, sessions in the same Postgres as
the monitors they open — no external identity provider, because a self-hosted
tool that needs a hosted one is not self-hosted.

**The first run makes the account, and `AUTH_SIGNUP` decides whether anybody
else may register.** US-066 reversed US-017's single-account rule on the owner's
decision — there is a cloud version, and a cloud version needs registration.
`closed | open`, and **the default is `closed`**, which is the one place the
implementation went against the literal request: every instance running today is
self-hosted, and a version bump that silently began accepting registrations is
the failure US-017 exists to prevent, arriving through a release note nobody
read. Both halves live in the `user.create.before` hook, which every path that
creates a user passes through, so the refusal cannot be routed around. There is
no default account and no default password.

**`claimUnownedRows` needed a guard the moment that setting existed.** It ran
for every created user, which was correct only because no second user could
exist. `isOnlyAccount` is the guard now. A stranger who registers on an open
instance and inherits the owner's monitors is the worst bug a shared instance
could have, and until US-066 nothing stopped it except the impossibility of a
second account.

**A provider key stored in the database belongs to an account; one in `.env`
belongs to the machine.** US-067 closed on 2026-09-08, reversing the deferral
US-017 recorded — US-066 made a second account possible, and until this ticket
every signed-in person shared one row per provider. Three faults at once: they
polled on one key and one bill, the second person to paste silently overwrote
the first, and anybody could delete a key and stop every monitor on the
instance.

A poll now uses the key of **the monitor's owner** and falls back to the
environment. `CredentialLookup` takes the owner as an argument rather than being
built per account, because one worker process serves every account — a lookup
per account would be a cache keyed by something, and the something is the owner.
`query_estimates` gained its own `user_id`, because the cost test usually has no
monitor to read one from and a sample is real money at a real provider.

**The environment half ignores the owner, and that is the self-hosted path.**
US-081 made that safe rather than documented: **where signup is open, the keys
in `.env` are not an account's to spend**, provider keys and model keys alike.
`config/machine-keys.ts` is the whole rule, asked once per composition root —
the API in `server.ts`, the worker in `runtime.ts` — and every layer below is
handed an environment with the keys already gone, so nothing downstream needs a
branch. Only the keys go: the provider, the model, the endpoint and the prices
are what a deployment was configured and measured for. With signup closed
nothing changes, which is the point of tying the rule to signup rather than
applying it everywhere. **No instance has yet run open with a `.env` key to
watch a poll refuse.**

**Two naming functions, and mixing them up is the mistake to avoid.**
`credentialRecordName` is `user:provider:field` — what the ciphertext is
authenticated with, so a row moved between two accounts' slots by anybody with
`psql` fails to decrypt; the primary key alone does not stop that.
`credentialSlotName` is `provider:field` — how a key is spoken about in a "this
is missing" message, with no owner, because that set is already one person's.
Read docs/secrets.md, *Whose key is it*.

**Proven live with two accounts on 2026-09-08.** Two rows for the same
provider, A's screen showing `••••AAAA` and B's `••••BBBB`; B deleted its own
key and **A's survived**; B's monitor form then named `BRIGHTDATA_API_KEY` as
missing while A's said ready. What is unproven is a live *poll* on a
per-account key — a real provider probe needs a real key, so the connectors
were never called.

**The providers page answered for the instance, and a new account saw somebody
else's numbers.** BUG-009, reported from a running instance on 2026-09-08 and
fixed the same day. US-067 scoped the *keys* on that route and left three reads
beside them untouched — the spend, the posts-and-matches, and the verdict count.
Nothing went red, because nothing on that page was scoped by a test.

**The lesson is countable: scoping a route means scoping every read in it.**
That one had four and three were missed. Migration 0045 added
`api_usage.user_id`, and it had to go into the unique key as well — the key is
`nullsNotDistinct`, so without the owner two accounts running a cost test on the
same pair on the same day would add their money into one row. `posts` is the one
table that cannot carry an owner, because a post is deduplicated across every
monitor on the instance; the page now counts the posts an account's monitors
matched or recorded a drop for, which is the same number on a single-account
instance.

**The provider *choice* is the same bug and is not fixed.**
`source_providers` is keyed by platform alone, so on an instance taking
registrations one account's choice changes what every other account polls
through — and by US-026's own rule a choice that cannot run is refused rather
than replaced, so it can stop another account's monitors dead.
[BUG-010](backlog/todo/BUG-010-a-provider-choice-is-shared-between-accounts.md)
is that ticket. The self-hosted instance is unaffected.

**A model key belongs to an account too, and a person picks a model per job.**
US-068 closed on 2026-09-08 with three cards and US-070 added the fourth the
same day. Scoring, triage, similarity, drafting a reply — four, because this
product asks a model four different things and the right answer differs: US-030
measured that triage only saves money when its model is cheaper than the
scorer's, Anthropic publishes no embedding endpoint at all, and a draft is the
one model output that carries somebody's name into another person's
conversation.

**Query generation and project describing stay on the classifier's settings**,
and that is a decision rather than an omission: both produce input a person
edits before anything is spent on it, and neither has anybody's name on it.

**US-070's migration exists only to widen a check constraint, and that is the
point of it.** `aiTasks` gaining a value is not the database gaining one. This
repository has shipped that exact mistake twice — `apify` in US-057 and
`draft_reply` in US-040 — and both times a full suite passed and a live run
found it after the money was spent.

**The whole design is one idea: a stored row is an override of the
environment.** `readAiEnvironment` lays an account's rows over the instance's
`AiEnvironment` and hands the result to the same three functions in
`ai/config.ts` that have always read it. Not one of their fallback rules is
reimplemented — triage falls back to the classifier's settings but not its
price, a key is reused only within one provider, an embedding model is never
guessed. Each took a measurement to get right, and a second copy is how one ends
up wrong. Two consequences fall out for free: a person who pastes only a key
keeps the deployment's measured choices, and an account with no rows behaves
exactly as before the screen existed.

**The worker caches a model client per owner for the life of the process**, so a
model key changed on the screen reaches the API at once and the worker on its
next restart. That is the one real cost of the design and docs/secrets.md says
so. Provider keys have no such cache.

**Every test passed before any of this was covered.** Every existing test
injects a client into `startWorker`, and injection still wins over the
resolver — so the entire new path was invisible to a green suite.
`ai/settings.test.ts` and `worker/classify-owner.test.ts` are what exercise it.
**A green suite after a refactor of a seam everything injects past is evidence
about the injection, not about the seam.**

**A model key is added once and a job points at it.** US-079 closed on
2026-09-09. `ai_keys` holds the account's keys — a name, a provider label and
the ciphertext — and `ai_settings.key_id` says which one pays for a job. Several
jobs may name one key, and a job that names none runs on the instance's.

That reversed US-078, written the same day and never shipped. US-068 kept a key
on each job's row, so a person with one key pasted it more than once; US-078
answered with a rule — a job borrows the key of any job on the same provider —
and the owner read the rule and called it confusing. It was: answering *whose
key pays for this job?* took two ideas at once. **A list a person picks from
beats a rule they have to hold**, and two jobs sharing a key is now a fact on
the screen.

Three things travel with it. **Migration 0050 is a move, not a
re-encryption** — `record` has been stored per row since US-024, so a
ciphertext changes tables and nobody retypes a key; it ran on the development
database and the moved keys decrypted. **A key's provider decides the job's**, when the
key states one — the card shows it rather than asking, because one question
with two fields is how an OpenAI key ends up on an Anthropic job, failing every
call and reading as a bad key. Where the card does ask, it offers **providers
and not settings**: no "instance default" entry, and the value is the provider
the job will run on. The model list follows it — `modelPrices` records which
provider sells each model, so a card offers three names rather than six. And **`pnpm db:rotate-key` had never touched model keys**, which US-068
introduced and nothing noticed — a rotation that reports success and then fails
every model call the moment the old key is thrown away. It walks both tables
now.

Two things are not built. **A model key is not tested when it is stored, and is
tested when somebody presses Test.** US-080. Validating on save spends money on
a call nobody asked for; a button is the person asking. The probe makes one
small structured call with the provider, model and key **on the screen** — test
first, then keep, because asking somebody to save first is asking them to commit
to what they pressed the button to doubt, and it answers
three states rather than two — the middle one is the provider accepting the key
and billing for it while the model returns the wrong shape, which sends a person
somewhere different from a refusal. It is recorded as `key_test`, and
**migration 0051 is what makes the database accept that purpose**: the same
mistake as `apify` in US-057 and `draft_reply` in US-040, caught this time
before it shipped. The probe is injected, so no test in this suite reaches a
provider. **Nothing has pressed the button against a real provider**, and **no
live model call has been made on a per-account key.**

**No route asks for a session, so none can forget.** One `onRequest` hook on
the root instance covers every API route, and what is *not* behind it is a
written list of three: `/api/auth/*` because it is the login, `/api/health`
because a container probe has no cookie and the answer holds no data, and
`/api/auth-status` because the login screen has to know whether to show a
sign-up form. The built UI is open too — it is the page the login form is on.

**The sidebar says which account is in use.** US-069 replaced a hardcoded
`Self-hosted` pill with the signed-in account's name and email. That label was
written before there were accounts, is false on an instance taking
registrations, and sat in the one place a person looks to tell two accounts
apart — the owner found it by spending a round trip working out which of two
accounts owned a stored provider key. `/api/auth-status` carries it, because
the shell already calls that route once on load. The route is open by
necessity, so it answers with an account only to a request carrying that
account's own cookie: a stranger who finds the port learns whether the instance
is set up and nothing about who set it up.

**The login screen has two forms and shows one.** `firstRun` decides between
"set this up" and "sign in"; `signUpOpen` decides whether a new account is
offered at all. They were one boolean until US-066 and are two now, because an
open instance that already has an owner is `firstRun: false, signUpOpen: true`.
Where signup is closed the switch between the forms is **absent rather than
disabled** — an offer that refuses is worse than no offer, because somebody
fills the form in before they meet the refusal.

**The test enumerates rather than samples, and that is the point.** Every other
correctness-critical surface has a rule you check at each call site; this one is
a claim about *all* the routes, and the route added next month is the one
nobody checks. So `apps/api/src/auth.ts` records what it registered and
`auth.test.ts` walks that list. Fifty-three method-and-path pairs today, and
every one of them answers 401 without a cookie.

**The cross-site check is on because we said so, not because of `NODE_ENV`.**
Better Auth's default turns it off when `NODE_ENV` is `test`, which had two
consequences: no test in this suite could reach the branch, and a deployment
whose `NODE_ENV` was not what its owner thought would lose the protection in
silence, with the login still working. `advanced.disableOriginCheck: false` in
`auth/auth.ts` states it once for every environment, and `auth.test.ts` now
proves it — sign-out with a valid cookie and no `Origin` is **403
`MISSING_OR_NULL_ORIGIN`**, the wrong origin is 403, the session survives both,
and only the right origin ends it.

**That check broke `pnpm dev`, and the shape is worth remembering.** Vite serves
the UI on 5173 and proxies `/api` to 3000 with `changeOrigin`, so Fastify sees
the host rewritten to 3000 beside the browser's untouched `Origin:
http://localhost:5173`. Better Auth compares them and answers **403
`INVALID_ORIGIN`** — every sign-in refused on a developer's machine, while
production, where one process serves both, works perfectly. `trustedOrigins` in
`server.ts` adds the dev server while `NODE_ENV` is development and never in
production, and `AUTH_TRUSTED_ORIGINS` carries any other split-origin
deployment. **A login that works in production and fails in development is not
a development-only problem** — it was the same check both times, and only the
origins differed.

**The first account adopts what came before it.** Every row written earlier
carries `user_id = 'self-hosted'`, and the sign-up hook re-points monitors,
projects, reply voices and verdicts to the new id in one transaction. Without
it, upgrading an instance that already polls shows empty screens over intact
data, which reads as data loss. Proven live: a scratch database seeded the old
way, one sign-up through the built app, and both rows came back under the new
id. `monitors.user_id` still carries **no foreign key**, and that is deliberate
— a monitor may be older than the first account, so the constraint would refuse
to apply on exactly the instances with data worth keeping.

**Provider keys stay on the machine, and that is a decision rather than an
oversight.** `source_credentials` is keyed by provider alone. The same lookup
falls back to the process environment — `BRIGHTDATA_API_KEY` and its siblings —
and an environment variable cannot belong to a person, so scoping only the
database half would make the two halves of one lookup disagree. The owner's
plan is per-account keys in a cloud tier; adding `user_id` there later is a
migration and a threaded owner, **not** a re-encryption, because `record` is
stored per row and an old row decrypts under its own stored name. US-017's
acceptance box for credentials is therefore recorded as deferred, with this
reason, rather than ticked.

**`AUTH_SECRET` is required and the process refuses to boot without it.** The
one boot check here that is about somebody else reaching the process rather
than about the process working — an instance that starts without it serves an
inbox and a set of money-spending keys to whoever finds the port, and every
screen works, which is why nobody would notice. `pnpm dev` writes one into a
fresh `.env`; `.env.example` cannot carry one, because a secret in git is a
secret every reader of this repository holds.

**One thing is still unproven: no real browser has rendered the login.** The
Chrome extension was not connected on the day it shipped, so the screen is
driven through jsdom and the server half through `curl` against the built app.
Read docs/accounts.md before changing the gate: it holds the proxy header a TLS
terminator must send, and the SQL for getting back in.

**The hosted version charges, and the self-hosted one never meets any of it.**
US-072 closed on 2026-09-08. `BILLING_MODE` is `off` by default, which is
`AUTH_SIGNUP`'s rule and reason: every instance running today is self-hosted,
and a version bump that quietly began refusing writes on somebody's own machine
is the upgrade nobody would forgive.

**The trial is a clock we own, and it makes no network call.** Seven days, no
card, one row written by the same sign-up hook that already claims the first
account's rows — and the two must not be confused, because claiming is for the
first account and a trial is for every account. A Stripe customer exists only
once somebody opens Checkout, so a person who registers and never returns leaves
no object in Stripe at all. The alternative — a Stripe subscription at sign-up
with `trial_period_days` — was refused because it makes registration depend on a
payment provider being reachable.

**One rule decides entitlement, and it is written twice in one file.**
`entitlementFor` answers about a row already read; `entitledCondition` answers
inside the scheduler's query, where a row per monitor cannot be read into
TypeScript first. `entitlement.test.ts` drives both over the same cases and
compares the two lists, because the only thing worth asserting is that they
agree.

**Reads stay and writes stop, and the rule is the method rather than a list of
paths.** Every route that changes something is a POST, PUT, PATCH or DELETE, so
the rule covers the route nobody remembers to add to a list — and
`billing.test.ts` walks every route the build registers, the way `auth.test.ts`
walks them for the session gate. A refusal is **402** with `x-billing-reason`:
not 403, because "you may not" and "you have not paid" send a person to two
different places, and in a header because a route's own error schema strips a
body key it does not name.

**The half that costs money is the scheduler.** A route that refuses is what a
person sees; `findDueMonitors` not returning an unentitled owner's monitors is
what stops our hosting being spent on an account that cancelled — and that one
is invisible from every screen.

**Two rows of the entitlement table are decisions.** No row at all means
entitled, because self-hosted nothing writes there and hosted there are accounts
older than the table, the owner's own among them. And `past_due` means entitled,
because a card that failed this morning is somebody Stripe is still retrying,
and stopping their monitors throws away collection they paid for. `canceled` is
where Stripe gave up, and that is the line.

**Stripe's webhook is the fourth open path, and the first one added since the
login shipped.** `auth.ts` says a fourth should be hard. It is justified because
Stripe has no cookie and never will, and the signature over the body is a
stronger check than a session rather than a weaker one. An event we do not act
on is answered 200, because a non-2xx makes Stripe retry it for days.

Two facts about the API version are worth keeping. `current_period_end` has
moved off the subscription and onto the subscription **item**, so reading the
old place returns undefined rather than an error — a null renewal date and
nothing to tell you why. The version is therefore pinned in `stripe.ts` rather
than left to whatever the account's dashboard says.

**Nothing about this has met a live payment.** The product and the $15 monthly
price exist in the test account, and no Checkout Session has been completed and
no card — real or test — has been entered. Read docs/billing.md before changing
any of it.

**Stripe has now delivered a webhook, to staging, and the signature verified.**
On 2026-09-08 a test-mode endpoint was created against the SignalScout Cloud
account for `https://app.signalscout-dev.space/api/billing/webhook`, subscribed
to the five events `billing.ts` acts on and no others. `stripe trigger
invoice.paid` fired a real event: the app answered 200 and logged no signature
failure. So the signature check, the raw-body handling and the open route are
proven on a hosted endpoint rather than on `stripe listen`.

**Two Stripe accounts exist and the CLI defaults to the wrong one.** The
`stripe` CLI on the development machine is signed in to an account that holds no
products at all; the key in `.env` belongs to the account holding "SignalScout
Cloud". Every CLI command about this product therefore needs `--api-key`, and a
`stripe listen` run without one listens to somebody else's account and reports
nothing wrong.

**A provider slower than a quarter of a second read as an outage, for as long
as this product has had connectors.** BUG-011, found on 2026-09-08 when a
ScrapeCreators key test failed from the screen. Node gives each address a
hostname resolves to **250 milliseconds** to connect and then fails with
`ETIMEDOUT`; `api.scrapecreators.com` takes **850 to 1,200 milliseconds**. So
about half of all calls to it failed, and the message a person read blamed the
two innocent things — their key, and the provider.

`net.ts` sets the budget to five seconds at the start of the API and the
worker, and carries the measurement. Raising it costs nothing on a healthy
call: the budget is only spent failing over between addresses, and a refused
connection still fails at once because that is a packet coming back rather than
a timeout.

**Three wrong theories came first and each looked right** — the provider's WAF
blocking undici's user agent, a dead A record, my own sandbox. What settled it
was the *shape* of the number: every failure was ~580ms and every success
780–1,280ms. A failure that consistent is a stopwatch, not a network.

**No test in this suite calls a provider, so no test could see it.** That is the
lasting lesson rather than the setting: a whole class of connection fault is
invisible to a green run, and the thing that found this one was running `curl`
against the same host from the same machine and watching one client wait where
the other would not.

**The inbox leaves as a spreadsheet.** US-064 closed on 2026-09-07. A link
beside the match count downloads the list *currently on screen* as CSV — every
filter honoured, every page walked, because a screen paginates and a file
should not.

**Two things about CSV here are correctness rather than formatting.** A cell
starting `=`, `+`, `-`, `@`, a tab or a carriage return is a formula in Excel
and Sheets, and this file is built from strangers' words: every cell is
prefixed so it can only be text. Proven against the database rather than only
in a test — a post title set to `=cmd|' /C calc'!A0` came back defused, words
intact. And the file carries a UTF-8 byte order mark, because Excel otherwise
reads it as the local code page and the Spanish, Hebrew and emoji in this
database open as mojibake.

**Measured on the running instance**: 171 lines, 20 matches, 12 columns, and
ten of the twenty holding a newline inside a cell — all surviving a round trip
through a real reader.

`.xlsx` was refused. Excel opens CSV, Sheets opens CSV, every CRM imports CSV,
and an `.xlsx` writer is a library and a binary format bought for nothing.
The label says CSV so nobody hunts for a second button.

**A reply can be drafted, and this product still never posts.** US-040 closed
on 2026-09-07. A match has a Draft reply button; pressing it asks the model
once, and the draft arrives in a textarea with a copy action and a line saying
nothing is posted from here. PLAN.md puts social publishing on the *not
building* list and the panel ends at the clipboard.

**Nothing is generated on a schedule.** No draft at poll time, at classify
time, or in advance, and no cache — pressing the button twice asks twice,
because that is what pressing it twice means. A draft costs a model call and a
person's reputation.

**The prompt is the product decision, and `ai/reply.ts` holds it in words**:
never open with the product, mention it once at most and preferably not at all,
never invent a fact about it, never claim to be a customer, and write any doubt
*into the draft* as `[check: …]` where somebody editing will see it. A model
told only to "write a reply" writes a landing page.

**The customization dialog's instruction box is what the model is told, and
the library only fills it.** US-063: choosing a saved voice copies its words
into the box, and editing it and pressing Apply steers that one draft. Saved
voices are created, edited and deleted on the account-level Reply voices page,
not while somebody is answering one conversation. Cancel discards the dialog's
staged values. For one awkward post, a person can say "answer the pricing
question first, this one time" and press the button — measured live, an
instruction of "exactly two sentences, do not ask anything back" produced
exactly that.

**Five voices ship with the product, and an account starts with all five
saved.** US-065 wrote them and offered them; on 2026-09-09 the owner decided
they should simply be there. The voices page opened on a blank box, which is
the hardest screen here to answer: a person who has never written an
instruction does not know what a good one looks like, and the ones they guess
at ask for what the prompt refuses. Each preset carries the measurement it came
from — `Reddit regular` because a subreddit treats a promotional reply as an
advertisement, `Technical detail` because LinkedIn's noise is
expertise-signalling, `Short comment` because a TikTok comment runs a median of
54 characters and an Instagram one 26.

`seedPresetReplyVoices` writes them in `user.create.after`, after claiming and
for every account, and migration 0049 does the same once for accounts that
already existed. **A name already taken is left alone**, which is why the order
matters: an instance upgrading from before the login may already hold a voice
called `Short comment`, and those are somebody's own words. Nothing is
overwritten and nothing is rewritten later — the migration is a snapshot of the
module and says so, because following the module would edit rows a person has
since changed. Presets are still offered, and the picker hides itself when
every one is saved, so it reappears exactly when somebody deletes one.

**A person saves reply instructions on their account, several of them, and
picks one when drafting.** Not per project: a voice is how one person writes,
so a copy per project would be the same words drifting apart. An instruction is
appended as a preference and the prompt says which rules it may not override —
"always open by naming our product" is the thing the prompt exists to prevent.

**One live draft is the evidence.** On a Reddit post asking how to reach a
first customer the model wrote practical advice, **mentioned the product not at
all** — which the prompt permits — and ended with a bracketed check because the
post never said what the product does. $0.005134 and 5.6 seconds on
`gpt-5.6-terra`.

**That run found a bug 1,335 tests could not, and it is the same one US-057
shipped.** `draft_reply` was added to `modelCallPurposes` in TypeScript and not
to the database's check constraint, so the call succeeded, the money was spent,
and *recording it* failed. Migration 0042 adds it. **A value added to an array
in `schema.ts` is not a value the database accepts** — twice in one day now,
after `apify`. Check the constraint.

Its fixtures are not captured from a real model:
[US-062](backlog/todo/US-062-a-real-model-s-drafts-are-replayed.md) is that
gap, and `ai/reply.test.ts` asserts the prompt's words meanwhile.

Three tickets are in `doing/`.
[US-017](backlog/doing/US-017-a-self-hosted-instance-has-one-account.md) is the
login, described above: everything works, and the credentials box is the
owner's call rather than an unfinished piece of work. It is also the ticket that
now blocks a real cloud deployment, because opening signup without per-account
keys shares the owner's bill.
[US-015](backlog/doing/US-015-a-deleted-post-stops-being-shown.md) has the
scheduled deletion job, budget guard, durable provider continuations and post
tombstones. Bright Data returned explicit deletion evidence in live captures.
ScrapeCreators returned ambiguous answers for both live and removed posts, so
its uncertain checks leave matches visible. That acceptance box remains open.
Read docs/deletions.md before changing verification.
[US-001](backlog/doing/US-001-the-workspace-runs-with-one-command.md) waits on
the first CI run, which needs a remote this repository does not have.

US-007 and
[BUG-001](backlog/done/2026-09/BUG-001-a-pending-reddit-collection-is-not-resumed.md)
closed together on 2026-09-05, when one live run carried a collection from the
trigger through fifteen poll jobs to forty-nine stored posts.

US-010 closed with US-023. It has the server routes, the React form and the
jsdom harness that drives the form through the DOM. Its last box — a monitor
with no *valid* credential cannot start — is met by the connections screen and
not by the form: the form still asks only whether a key exists, because a
resume that called a provider would be refused by an outage that has nothing to
do with the key.

**The inbox has shown real matches.** On 2026-09-05 US-022 carried one
monitor from the form to twenty matches, scored by a live model and read on the
screen. The top one scored 71: a QA lead joining a company with no automation,
who asks what to prioritise from day one. The reasons are specific to the post
and a person can act on them. US-011's other measurement stands: the ordering
rule — score, minus twelve points for every day since the post — at 12.7 ms for
a first page over 5,000 matches.

**Five verdicts have been given on real matches, and they rank perfectly.** On
2026-09-05 a person read five of US-022's matches and answered: good at 71 and
59, not relevant at 53, 52 and 50, every one against version 1.

This paragraph said "the verdicts do not follow the scores" until 2026-09-06,
and that was wrong. Every post the person kept scored above every post they
refused. The ordering is exact.

What is thin is the **margin**, and that is what the original sentence was
reaching for: six points between the lowest good and the highest refusal, with
all five inside a 21-point band. The three refused posts ask how to learn test
automation, which is a career question and not a buyer, and the classifier
scored them close to the two that were kept.

**Two things follow.** With two goods and three refusals, a perfect split
happens by chance one time in ten, so five verdicts support the idea that a
higher score is a better lead without proving it. And **the boundary sits near
56 while `defaultMinimumScore` is 30**: all three refused posts cleared the
default and reached the inbox. US-022 found the same direction independently
when it measured that 30 was too low inside a topical subreddit and 50 left
nine matches that were all real.

**Five verdicts on one monitor is not a distribution.** US-033 is the ticket
that reads the other forty, which are already collected and cost nothing. The verdicts
are still collected and not used: feeding them back into the classifier is a
separate ticket that is not written, because a learning loop with nothing to
learn from is speculation.

One rule from that ticket is easy to get wrong later. `monitors.version` counts
edits to the four fields `ai/prompt.ts` puts in the system prompt — the
product, the ideal customer, the problem and the signals — and nothing else. It
is the version a verdict was given against. A rename, an edited query or a
moved threshold must not move it.

**The Reddit connector has collected twice, live, and both discovery modes
are proven.** On 2026-09-05 a monitor with one keyword triggered a collection,
waited through fourteen resumes over 7.6 minutes, and stored forty-nine real
posts. A real DNS failure hit a poll job in that run, and the retry recovered
it. Later the same day US-022 collected one subreddit: fifty records for
$0.075, with the snapshot ready after 8 minutes 40 seconds. The trigger, the
wait, the cursor, the snapshot read and the storage are proven for the keyword
phase and the subreddit phase alike.

Three things are still unproven: an expired snapshot, a collection the provider
reports as failed, and a rate limit.

That run also measured what nobody had measured. A monitor left at the
60-second floor triggered a collection every minute, and each one billed 9 to
11 records and returned no posts, because everything it found was older than
the last poll. Poll frequency is a cost dial. US-013 turned half of that lesson
into a limit; US-014 turned the other half into arithmetic — polls a month is
the multiplier, so the same query costs $10.80 a month polled hourly and $648
polled every minute.

**Keyword discovery returns noise. A subreddit does not.** On 2026-09-05
US-022 collected the same monitor both ways, for the same $0.075. The model's
own keyword, "end to end tests keep breaking", brought back "failed both exams
and don't know what to do" from r/AllFinraExams and "A never ending test" from
r/islam: Bright Data matched "test" and "end" as ordinary words. One subreddit,
r/softwaretesting, brought back fifty posts that are all on topic. The
forty-nine posts the earlier keyword run stored are the same noise, and so are
the four matches they produced.

Two numbers came with that. A `min_score` of 30 is too low for a subreddit:
"Dev memes" scored 33 and reached the inbox, because inside a topical subreddit
every post is somewhat relevant and the scores compress upward. At 50 the same
poll leaves nine matches and all nine are real. And the pre-filter dropped one
post of fifty, because it was built for keyword noise — with subreddit
discovery every collected post costs a model call, and that belongs in any
arithmetic shown to a person.

**The budget guard has now refused a real poll, and US-049 is when.** On
2026-09-06 an Instagram poll under a $1.00 cap spent $1.6317 and both paid
stages refused: `classify` stopped with 89 comments unread — BUG-004's
mid-batch branch, reached live for the first time — and `replies` refused to
open four more threads. **The overshoot was 63%**, larger than anything
recorded before, because each overshoot step on that platform is a 5-credit
comment page rather than a 1-credit one. Read the rest of this paragraph as the
history it now is. It has now allowed one
and counted it: US-022's poll ran under a $0.20 cap and recorded $0.075 against
it. Refusing is the half that no live run has reached. US-013's arithmetic, its
cap and its two exhausted behaviours are asserted against real Postgres and a
fake connector, and six deliberate mutations were confirmed to turn the suite
red. What no test can prove is the input: the guard multiplies the units a
connector reports by the price the connector declares. One day has now been
compared against the provider's dashboard: on 2026-09-05 Bright Data reported
95 records and $0.14, and `api_usage` held 98 records and $0.147 — 3.2% high,
not low. That is one day against a dashboard, not a reconciliation against an
invoice. Say the spend is an estimate, because
[docs/costs.md](docs/costs.md) says so to the user in four specific ways.

**An embedding has no price until somebody sets one.** `provider.ts` carries
chat prices read from a provider's page; we have read no embedding price, so an
embedding call is recorded with a null cost until `AI_EMBEDDING_PRICE_MICROS`
is set. Null means "we cannot say", which is the same rule an unpriced chat
model already follows. Do not fill that table from memory.

**A cap can be overshot by one poll.** The guard runs before a poll, because a
page is billed when it is fetched. It cannot know what that poll will cost, so
a monitor at $9.99 of a $10.00 cap starts one more poll. `maxPagesPerPoll`
bounds the overshoot. US-014 does not remove it and was never going to: what
the cost test changes is that a person is shown the size of the thing before
they start it.

**The cost test has run three times, and the first run corrected it.** On
2026-09-05 three samples were collected live for $0.042. The trigger, the wait, the cursor, the
resume and the unattributed `api_usage` row all worked. The arithmetic did not:
it projected from the posts a sample kept, and the provider bills the records
it collects. A query that had just cost ten records was reported as free.

It now projects from `unitsConsumed`, and reports a range whenever a sample was
billed everything it asked for, because one sample of ten cannot say what a
poll of fifty costs. **Cost comes from units and volume comes from posts. Never
price anything from a post count** — that is the mistake, it cost $0.042 to
find, and the interface has carried `unitsConsumed` for exactly this reason
since US-003.

A second run, after BUG-002 was fixed, verified the window: the same keyword
kept all ten posts inside seven days, where it had kept none. What is still
unproven is that a keyword sample of ten predicts a keyword poll of fifty. The
range is an admission of that, not a measurement of it.

A third run, in US-022, billed ten records for $0.015 and projected $10.80 to
$54.00 a month for one keyword polled hourly, which is over a $0.20 cap, so the
form offered to save the plan without starting it. **The three live tests took
1 minute 41 seconds, 8 minutes 8 seconds and 2 minutes 45 seconds**, so the
screen's "about two minutes" is the fastest case and not the normal one.

---

## Before you start a task

1. Find its ticket in [`backlog/OPEN.md`](backlog/OPEN.md). If there is no
   ticket, ask whether to write one first.
2. Read the ticket's **Context**. It holds the reasoning that the code cannot.
3. Read [`docs/testing.md`](docs/testing.md) if you will write a test, which is
   almost always.
4. Read [`docs/sources.md`](docs/sources.md) if the task touches a connector.
   It holds two lists — adding a provider, and adding a platform — and the
   three things connectors get wrong.
5. Read [`docs/costs.md`](docs/costs.md) if the task touches money — a price, a
   cap, a usage row, or a figure shown to a person. It holds what our estimate
   is wrong about, and why it is never rounded to cents.
6. Read [`docs/secrets.md`](docs/secrets.md) if the task touches a credential.
   It holds where a key lives, what the encryption guarantees, why a key is
   tested before it is stored, and the rotation steps.
7. Read [`docs/billing.md`](docs/billing.md) if the task touches the paywall,
   the trial or Stripe. It holds who is entitled, what a refused write answers,
   and why the scheduler is the half that matters.

The ticket's **Acceptance** list is the definition of done. Every box is true
or false. Do not mark one done that you have not verified.

---

## Rules that are easy to break

**Every address is a path, and `route.ts` holds them all.** US-076 moved the
router out of the hash on 2026-09-08, after Stripe returned a person to
`/billing?checkout=done#/billing` — one address saying the same thing twice,
because the path was the server's answer and the hash was the application's.
`apps/web/src/route.ts` is the whole table: `routes` are the patterns
`App.tsx` matches, `paths` are the builders every screen links with. Never
write an address as a string beside a link.

**A project is a path segment, not a query parameter.** `/projects/<id>`,
`/projects/<id>/monitors`, `/projects/<id>/monitors/new`. An inbox is a
question about one business, so the address is *of* that business. US-045's
rule — no project, no inbox — is the route table itself now rather than an
effect that corrects the address after rendering: an address naming no project
matches no project-scoped route and the catch-all sends it to choose one.

**The UI shares one theme.** Read [docs/design.md](docs/design.md) before changing a screen. Colors and sizing live in `apps/web/src/styles/tokens.css`; shared controls live in `styles/theme.css`. Keep page layout separate, and migrate the remaining screens one at a time.

**`packages/core` imports neither Fastify nor React.** The API and the worker
both call into it. This is the one architectural rule in the repository. If a
change seems to need it, the change is wrong.

**A red test is fixed in the code, not in the assertion.** An expected value
changes only when the behaviour was meant to change, and the commit says which
and why. You write both the test and the code, so nothing else stops one
misunderstanding being encoded twice.

**No test spends money.** No test reaches the Reddit API, the X API, or a model
provider. An X read is billed at $0.005 and a test loop does not stop when the
assertion passes. `vitest.config.ts` blanks `AI_API_KEY` for the whole suite,
so a machine with a key exported cannot spend one by accident.

**Fixtures for someone else's API are captured, not written.** Never write a
Reddit or X payload from memory, however plausible. A fixture you wrote is
evidence about our parser and no evidence at all about the wire format. The
same holds for a model's answers: `ai/fixtures/*.json` came from a real
provider through `capture.ts`, and an answer you wrote would be evidence about
our schema and none about the model.

**One migration number, one file.** Two branches that each take the next number
merge cleanly and break at boot.

**The folder is the ticket's status.** Moving a ticket is `git mv`, in the same
commit as the code that caused it, followed by `backlog/index.sh`. There is no
`status:` field. Never add one.

---

## Decisions that are settled

Do not reopen these without being asked. The reasoning is in
[STACK.md](STACK.md) under *Why these choices*.

| Not this | This |
|---|---|
| Next.js | Vite static build + Fastify |
| Redis, BullMQ | `pg-boss` inside Postgres |
| A separate vector database | `pgvector` |
| Prisma | Drizzle |
| Python | TypeScript |
| A managed auth service | Better Auth in our own Postgres |
| An in-memory Postgres fake | Real Postgres, from the first test file |
| A Reddit API key per user | Reddit through a provider: Bright Data, ScrapeCreators or SocialCrawl |
| X's own pay-per-use API | X through SocialCrawl, the one provider of three that can search X |
| A platform's price kept on the platform | The price on the pair: one SocialCrawl key, one credit price, and a call that costs 1 on X and 5 on LinkedIn |
| One record describing a source | A platform and a provider, separate; a connector is the pair |

**One row above was reversed on 2026-09-05.** It read: *a provider picker in the
UI* against *one provider per source, named but not chosen*. That was right
while Reddit had one usable provider and wrong the moment two fetch the same
platform, so US-024 separated the axes and the connections screen is now keyed
by provider. STACK.md, *A source is not a provider*, holds the reasoning. The
rule underneath is unchanged: the interface is not weakened to suit a provider,
and nothing downstream of a connector learns which one answered.

If you believe one is wrong, say so in one paragraph and wait. Do not
reintroduce it as part of another change.

---

## Correctness-critical surfaces

These are written test-first: the assertion is written and reviewed before the
implementation. Each file carries a `Correctness-critical` header comment
naming its failure shape.

- **Budget guard** — money spent past a cap, silently, at 02:00
- **Cursor and deduplication** — the same post fetched and billed twice
- **Credential encryption** — a key reaching a log line or an API response
- **Classification schema** — an invalid score stored as if it were a verdict
- **Deletion reconciliation** — removed content still being shown
- **Session gate** — a route answering a stranger, and looking normal doing it
- **Entitlement** — an account that stopped paying still polling, on our bill

A rule is only as tested as its least-tested caller. After asserting the rule,
count the call sites and give each its own case.

---

## Commands

```bash
pnpm dev                      # Postgres, migrations, API (3000), Vite (5173), worker
pnpm test                     # Vitest; needs the Postgres that `pnpm db:up` starts
pnpm lint                     # Biome: formatting and lint rules together
pnpm typecheck                # tsc --build across the workspace, plus the web app
pnpm build                    # every package, then the Vite bundle
pnpm db:up                    # Postgres alone, for `pnpm test`
pnpm db:migrate               # apply migrations to DATABASE_URL, read from .env
pnpm db:generate              # drizzle-kit generate, after a schema change

docker compose up             # the published image: Postgres, migrations, the app

pnpm db:rotate-key            # re-encrypt stored credentials under a new key

backlog/index.sh              # rebuild OPEN.md and DONE.md — run after any ticket change
backlog/index.sh --check      # exit 1 if either list is stale

pnpm --filter @signalscout/core capture:classifier   # spends money; see below
pnpm --filter @signalscout/core capture:queries      # spends money; see below
pnpm --filter @signalscout/core capture:embeddings   # spends money; see below
pnpm --filter @signalscout/core capture:comment-filter # spends money; see below
pnpm --filter @signalscout/core capture:triage        # spends money; see below
pnpm --filter @signalscout/core live:provider-switch # spends ~$0.08; see below
pnpm --filter @signalscout/core live:linkedin-poll   # spends ~$0.08 + model; see below
pnpm --filter @signalscout/core live:x-poll          # spends ~$0.002 + model; see below
pnpm --filter @signalscout/core live:apify-linkedin-poll # spends ~$0.05 + model; see below
pnpm --filter @signalscout/core live:tiktok-poll     # spends ~$0.20 + model; see below
pnpm --filter @signalscout/core live:tiktok-comments # spends model only; see below
pnpm --filter @signalscout/core live:instagram-poll   # spends ~$1.65 + model; see below
pnpm --filter @signalscout/core live:instagram-comments # spends model only; see below
pnpm --filter @signalscout/core live:thread-loop      # spends up to a cap you pass; see below
pnpm --filter @signalscout/core measure:lead-position # spends ~$0.40; see below
pnpm capture:deletions                            # spends ~$0.02; see below

node packages/core/src/sources/providers/socialcrawl/linkedin-fixtures/capture.mjs   # ~30 credits
node packages/core/src/sources/providers/socialcrawl/instagram-fixtures/capture.mjs  # 24 credits, or 14 with --lean
```

These eleven are the only commands here that spend money, and all eleven are
instruments: they ask a real provider something and record what it said,
because an answer we wrote would be evidence about our own schema and none
about the provider.

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

`live:linkedin-poll` is US-028's equivalent. The script behind it is
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

Re-run any of them when its prompt, its schema or the model changes, and put
the numbers in the ticket.

Do not invent a command that does not exist yet — check `package.json` first.

`pnpm test` uses a real Postgres and creates a database per test file. If it
cannot reach one it says so; it does not fall back to a fake.

**It can go red without a broken test.** A database per file, run in parallel,
can outrun Postgres `max_connections` of 100: a file fails with "sorry, too
many clients already", sometimes surfacing as a 500 from a route whose insert
could not get a connection. The failing file moves between runs and passes
alone, so it reads as flakiness rather than as what it is. Check that before
reading a red run as a regression.

Two settings hold it off and both live in `vitest.config.ts`:
`DATABASE_POOL_SIZE` caps each pool at three, and `maxWorkers` caps the run at
four. **Pass `--maxWorkers` by hand only to go lower**; the advice to run at
three is older than the pool cap and costs about ten seconds.

**Six workers were tried and reverted, and the reason is worth keeping.** They
peak at 57 connections of the hundred and finish in 39 seconds against four's
41 — but `classify.test.ts` then failed two runs in four, an `until()` wait
exceeding its twenty seconds under load rather than a broken assertion. Two
seconds is not worth a suite that cries wolf: a flaky run costs far more than
it saves the moment somebody starts ignoring it.

**The suite takes about 41 seconds, and it used to take 170.** Almost all of
that was one number. Five pg-boss worker files were 397 of the 435 seconds of
file time, every test costing four to six seconds to do milliseconds of work,
because a pipeline test sends a job and then waits for a worker to poll for it.
`WORKER_POLLING_INTERVAL_SECONDS` is set to pg-boss's floor of 0.5 for the
suite alone, and nothing sets it in production — a poll that starts a second
later is a poll that starts a second later, and a query per queue per second
against a working database buys nothing.

If a worker file starts costing seconds a test again, that is the number to
look at first, and `--reporter=json` gives the per-file timings that show it.

---

## Writing

**Repository documents keep the project's voice.** Short sentences, active
voice, one idea per sentence. No idioms, no metaphors. Say "the tests pass",
not "green".

**Commit messages stay under 300 words.** Subject as a prose sentence, then a
body holding only what the diff cannot say — the why, the constraint, the
decision that would otherwise be made twice. Do not list the changed files. The
diff already shows them.

**A ticket body has four headings and no others:** Context, Acceptance, Notes,
Log.

**A ticket date carries a time.** `created` and every Log entry use
`2026-09-05T07:31+08:00` — ISO 8601, to the minute, with the offset. Several
entries land on one day, and only the time says which came first.

---

## What to do when you are unsure

Say so, in one or two sentences, and continue with everything the uncertainty
does not block. State the assumption you made.

Do not: silently narrow the scope, add a dependency to avoid a hard problem,
mark an acceptance box done because it is probably fine, or produce a summary
that reports work you did not verify.

If a change's reason for existing rests on third-party behaviour — a rate limit
header, a provider's payload shape, an OAuth refresh — the suite covers our half
only. Say that the claim is unproven until it runs somewhere real.
