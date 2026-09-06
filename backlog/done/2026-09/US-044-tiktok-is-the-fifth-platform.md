---
id: US-044
title: TikTok is the fifth platform
type: feature
priority: p2
created: 2026-09-06T13:25+08:00
parent: US-038
area:
resolution: shipped
---

## Context

**PLAN.md said not to, and this is the third time.** The rule at PLAN.md's
*Important rule* is that no further network is added until Reddit and X reliably
produce useful matches. That condition is still unmet in the same words it was
this morning: **five verdicts exist and forty-seven matches sit unjudged**.
LinkedIn crossed the rule in US-028 and YouTube in US-034, and both were
recorded as decisions rather than absorbed. This is the third crossing and the
owner made it. It is written here, in STACK.md and in AGENTS.md so the next
reader finds a decision, and the rule still stands for the sixth.

It is split out of [US-038](../parked/US-038-instagram-tiktok-and-threads.md),
which parked three platforms together and said that when they were unparked they
should be split — because US-028 and US-034 both found that one provider does
not mean one contract.

**It is the cheapest platform this product has met.** From SocialCrawl's free
catalogue on 2026-09-06: `/v1/tiktok/search` is **1 credit** and paginated,
`/v1/tiktok/post/comments` is **1 credit** and paginated, and
`/v1/tiktok/video/comment/replies` is 1 more. Compare LinkedIn at five credits a
search page.

**Expect the YouTube shape, more so.** US-034 measured that a YouTube search for
`flaky tests` returned 45 results and every one of the first twelve was a
tutorial — a video is something published to be seen, and the lead is in the
comments underneath. TikTok is further from text than YouTube, not closer: there
is no description field of any length, a caption is a line, and whatever a
person says about their problem they say in a comment or not at all.

So the reply path is this connector's foundation rather than an addition to it,
exactly as it was for YouTube. A TikTok monitor without `includeReplies` will
find nothing worth reading, and the platform's own note should say so the way
YouTube's does.

**Two things are unknown and one of them decides the whole thing.** Nothing has
called either endpoint. And there are two search endpoints — `/search` and
`/search/top` — which the catalogue does not distinguish beyond the name. One of
them may be relevance-ranked and one recent; a monitor wants what was said since
it last looked, and US-034 measured what an approximate date does to that.

**The real question this platform has to answer is whether anybody there is
describing a problem in words.** YouTube's comment match was a person asking for
a Cypress alternative — a sentence. TikTok comments are shorter, and the honest
possibility is that this platform is cheap because there is little text in it.
The capture should look at what the comments actually say, not only at whether
they parse.

## Acceptance

- [x] `tiktok` is a platform in `db/schema.ts`, in a migration, and
      `PlatformDescriptor` carries its own query rule and a note saying the
      lead is in the comments
- [x] Fixtures are captured from a live account by a script under the
      connector's own directory, with author identity scrubbed, and are read
      before they are committed
- [x] The Log says what `/search` and `/search/top` each returned, and which
      one this connector uses, with the reason
- [x] The connector searches by keyword and pages by cursor, and a test replays
      a captured answer
- [x] `since` is applied from a date the provider stands behind, and the Log
      says whether it publishes one
- [x] The connector reads comments through `fetchReplies`, declares
      `canFetchReplies`, and stores them as `kind = 'reply'` rows under their
      video — through the shared parser, which US-020 proved reads every
      SocialCrawl `CommentList`
- [x] `ReplyResult.partial` is reported from evidence, the same rule the other
      three connectors follow
- [x] The Log records what one search and one comment page cost and returned,
      measured
- [x] **The Log says whether a TikTok comment is long enough to be a lead**,
      judged by reading them rather than by counting rows
- [x] STACK.md and AGENTS.md record the fifth network as a decision, and that
      the rule stands for the sixth

## Notes

- Depends on [US-020](../doing/US-020-a-monitor-can-include-comments-and-replies.md)
  for the reply path, which is built, and on the shared parser in
  `socialcrawl/comments.ts`.
- A credit is 8,118 micro-dollars. One search and one comment page is $0.016,
  which makes the capture the cheapest this repository has run.
- `/v1/tiktok/post/transcript` is 10 credits and `/v1/tiktok/video/screen-text`
  is 5. Neither is in scope: a video's words are the publisher's, not a buyer's,
  and that was the same decision US-034 made about YouTube transcripts.
- Channel discovery is out of scope for the reason it is everywhere else — a
  monitor exists to find a stranger, and a named account is not one.
- **Read the fixtures before committing them.** Two captures in this repository
  leaked identity on their first run, both caught by an audit rather than by
  reading. TikTok handles appear inside comment text the way X handles do.

## Log

- 2026-09-06T13:25+08:00 — Written at the owner's request, and split from
  US-038 rather than unparking all three. The framing that matters is US-034's:
  a video is published to be seen, so the lead is underneath it — and TikTok is
  further from text than YouTube, so the question the capture must answer is
  whether its comments say enough to be leads at all.

- 2026-09-06T13:32+08:00 — Captured, six credits, $0.049. **The capture answered
  the question the ticket asked it to, and the answer is no.** Nothing has been
  built and the connector should not be, on this evidence.

  **The words mean something else here.** A search for `flaky tests` returned
  30 videos, and the platform's reading of both words is not ours:

  * *flaky* means **dandruff**. Scalp treatment, psoriasis, "sideburn flakes",
    an ASMR scalp examination, dandruff removal.
  * *test* means **a school exam**. The second query, `my tests keep failing`,
    returned nothing else at all: studying, failing, ChatGPT-for-homework.

  `/search` and `/search/top` returned the same shape of noise, so which one
  this connector would use is moot.

  **The on-topic results are vendors, not people.** Two of thirty were about CI
  — "Drive consistent CI success and maintain a high-quality codebase" and "Your
  flaky tests are burning $50K+ a year, and nobody is tracking it 💸". Both are
  marketing. US-034 measured that a YouTube search returns publishers rather
  than people; on TikTok the same is true and the publishers are selling the
  thing this monitor sells.

  **The comments cannot carry a lead.** The busiest video in the result set
  claimed 377 comments, and a page of 50 has a **median length of 19
  characters** with exactly one over 80. The longest is *"oh God.. I have a
  chemistry test tomorrow and I think that is gonna be easy"*. YouTube's comment
  match was a person asking for a Cypress alternative, in a sentence. There is
  no sentence here.

  So the honest possibility the ticket named is the measured answer: **this
  platform is cheap because there is little text in it.** Not for want of a
  connector — the endpoints work, they are one credit each, they page, and the
  payload is the same envelope the other three read.

  The fixtures and the capture script are committed anyway. They cost real money
  and they are the evidence for this decision; the next person to propose TikTok
  should find them rather than spend the credits again. The audit flagged
  `@tiktok` in six files and it was a false positive — my own `@tiktok-user-N`
  pseudonyms matching the pattern that looks for handles.

- 2026-09-06T13:32+08:00 — First recommendation, **later withdrawn**: do not
  build the connector. See the entry below.

- 2026-09-06T13:38+08:00 — **The entry above tested the wrong thing, and the
  owner said so.** PLAN.md's example monitor sells a QA tool, and `flaky tests`
  is close to the worst query that could be sent to TikTok: both words are
  homonyms there. The measurement was sound and the conclusion drawn from it was
  too broad — "not a platform for this product" was a claim about one product on
  one query.

  Four more searches and three comment pages, four credits. **TikTok holds
  leads, and whether it does depends on the category rather than the platform.**

  A consumer query returns exactly what it should. `budgeting app
  recommendations`, `what app do you use to edit videos` and `best skincare for
  acne scars` each returned 30 on-topic videos with comment counts of 89, 321,
  1081, 2618, 4933.

  The videos are still publishers, as US-034 found on YouTube — "I tried a bunch
  of budgeting apps so you don't have to" is a creator, not a buyer. So the lead
  is underneath, and that is where the categories separate:

  | Video | Comments | Median chars | Over 60 |
  |---|---|---|---|
  | Meal planning, 2,618 comments | 48 | **16** | 6 |
  | School exam (first run) | 50 | **19** | 1 |
  | Acne moisturiser, 1,165 comments | 49 | **54** | **22 of 49** |

  And the acne thread's top comment is the shape this product exists to find:
  *"Is it safe to use for someone who has fungal acne, redness, sensitive skin,
  and oily skin? I badly want to try it, but…"* — a person listing their own
  condition and asking whether the product suits them. That is a lead by any
  reading.

  **So the finding is not about TikTok. It is about what people go to a comment
  section to do.** Under a recipe they say "code?" and "and its called?". Under a
  skincare product they describe their skin at length, because they have to in
  order to get a useful answer. A monitor whose customers have a condition they
  must describe will find people here. A monitor whose customers are engineers
  will not, and neither will one selling a recipe app.

  **One thing nothing else in this product has met: the comments are
  multilingual.** French and Spanish in one page of 49, at full length. Every
  prompt here is English and no connector has ever returned a language the
  classifier was not written for. That is not a blocker and it is not free
  either — it belongs in the Log before somebody meets it as a surprise.

- 2026-09-06T13:38+08:00 — Recommendation, revised: **build it.** The endpoints
  work, page, cost one credit each and return the envelope the shared parser
  already reads. The platform's own note should say what the measurement says —
  that the lead is in the comments, and that this platform suits a monitor whose
  customers describe a condition rather than one selling to engineers.

- 2026-09-06T13:52+08:00 — Built. Ten credits across both capture runs, $0.081,
  and 1,054 tests pass.

  **The shared parser read a fourth platform without a line of its own.** That
  is the claim US-020 made and this is the strongest evidence for it: TikTok's
  comment carries the same nine field names as X, YouTube and LinkedIn, and
  `comments.ts` needed no change.

  **Dates are exact.** `published_at` is a real per-second instant, unlike
  YouTube's derived ones — so `since` is applied directly and there is no
  `postedAtIsApproximate` here.

  **The one platform-specific decision is the comment link.** TikTok leaves
  `url` null on every comment, as YouTube does. YouTube's `&lc=` is a format its
  own Share button produces; TikTok's is not something anybody here has checked.
  So the fallback appends `?comment_id=` and the code says plainly that it is
  unverified: if TikTok honours it the reader lands on the comment, and if it
  does not the link is still the video, which is where the comment is. A reply
  nobody can open is a lead nobody can act on.

  **A video with no caption is dropped.** TikTok has no title and no
  description, so the caption is the only text a video carries — storing one
  without it would buy a classification to score silence.

  One test pins what the platform is rather than what the code does: the median
  comment on the captured thread is under 40 characters. The platform note says
  the lead is in the comments, and a reader who saw only that sentence would
  expect more text than there is.

- 2026-09-06T13:52+08:00 — Unproven, and it is the same list every connector
  starts with: no live poll through the worker, no rate limit, no outage, no
  second poll proving deduplication. And nothing has yet classified a
  non-English comment, which this platform will produce — one captured page of
  49 held French and Spanish at full length.


- 2026-09-06T14:10+08:00 — **The first live poll ran, and it found a bug rather
  than a comment.** A paused monitor for a skincare product — not the QA one,
  which was the wrong test for this platform — with the single query `best
  skincare for acne scars` and a $1.00 cap, driven through collect, filter,
  classify and replies in the real order.

  **60 videos in 6.7 seconds for 2 credits.** The pre-filter kept 33. 25
  threads were opened, 25 comment pages were bought, and `api_usage` holds one
  row: 27 units, 219,186 micro-dollars. The whole run took 4 minutes 24
  seconds, of which the classifier was 2 minutes.

  **Three matches, all videos, none of them comments** — and no comment was
  even stored. That is BUG-006: the reply window was the later of a ninety-day
  floor and `monitors.last_polled_at`, and `collect.ts` sets that mark to now
  in the same poll, so every provider was asked for comments newer than the
  moment the poll began. One of the 25 threads was re-read by hand afterwards:
  8 comments, written January to July 2026, one of them inside the correct
  window. The step was working exactly as written and could never have stored
  anything.

  So the claim this integration rests on is still untested. What the run does
  prove is the rest of the path: search, price, dedupe against an empty table,
  triage, classification, and a comment page bought and parsed.

  **The three video matches are people, not vendors, which the capture did not
  predict.** At 70, a person describing their own body acne and post-acne
  marks, mid-routine, asking viewers what they have tried. At 64, "What routine
  should I build next?" with five brands tagged. At 50, a person reviewing
  every dark-spot serum they have tried and asking for a recommendation because
  none of them worked. All three name products they have already bought.

  That is the correction to this ticket's first conclusion recorded in full.
  The captured `flaky tests` thread said a TikTok comment cannot carry a lead;
  what it actually measured is that a QA product has no audience here. A
  consumer monitor finds people on this platform, and finds them in the
  captions — which is the opposite of the shape predicted for it.

- 2026-09-06T14:58+08:00 — **A TikTok comment scores higher than any TikTok
  video, and that is the finding this ticket was opened to get.**

  With BUG-006 fixed, the second poll stored **678 comments** under 25 threads
  where the first stored none. It also proved deduplication on videos: the
  search returned 58, of which 44 were already held and 14 were new.

  That poll was stopped part way through triage. The estimate given before it
  ran counted the comment pages and forgot the model half, which is $0.177 of
  triage plus about $3 per hundred classifications on `gpt-5.6-terra`. The cap
  would have held it at $1.00 — both paid stages read the spend meter — but
  $1.00 was five times what was quoted, so it was stopped and the question was
  asked a cheaper way.

  `live:tiktok-comments` is that cheaper way, and it is new. It reads comments
  already stored, so it calls no provider: the pages were bought once and a
  stored comment is bought for ever. **60 comments, $0.198, and seven matches at
  or above 50.**

  The top scored **82**, against 70 for the best video:

  > the althea one broke me out 😔does anyone have any idea why that might be?
  > Would the yumu one be better?

  That is a person naming a product that failed them, asking why, and asking
  whether a specific alternative is better — under a video listing moisturisers
  for acne-prone skin. Two more at 68 and 66 are the same shape: one describing
  a product giving them "sooo many little pimples", one asking whether La
  Roche-Posay helps cystic acne.

  **Three measurements come with it.**

  *The pre-filter has almost nothing to cut here.* Triage dropped 4 of 60. On
  US-030's Reddit thread it dropped 20 of 26 people answering. The reason is
  structural: under a post asking for advice the crowd is experts answering, and
  under a product-recommendation video the crowd is customers. So on this
  platform the cheap stage saves little and nearly every comment buys a
  classification, which is what makes a full poll expensive.

  *Two of the seven matches are Spanish*, scored correctly with reasons written
  in English — "Donde las compráis ???" and "En Amazon se puede comprar??". That
  closes the open item about non-English comments, on two examples.

  *Below about 60 the matches change kind.* Those two Spanish ones, at 56 and
  54, ask where to buy somebody else's product. That is purchase intent and not
  a problem being described, so `min_score` does real work here rather than
  trimming a tail.

  All seven came from **two videos**. Sixty comments and two threads is not a
  distribution, and the concentration is itself a result: the value is in
  finding the right video, not in reading more comments under the wrong one.