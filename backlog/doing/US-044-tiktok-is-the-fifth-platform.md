---
id: US-044
title: TikTok is the fifth platform
type: feature
priority: p2
created: 2026-09-06T13:25+08:00
parent: US-038
area:
resolution:
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

- [ ] `tiktok` is a platform in `db/schema.ts`, in a migration, and
      `PlatformDescriptor` carries its own query rule and a note saying the
      lead is in the comments
- [x] Fixtures are captured from a live account by a script under the
      connector's own directory, with author identity scrubbed, and are read
      before they are committed
- [x] The Log says what `/search` and `/search/top` each returned, and which
      one this connector uses, with the reason
- [ ] The connector searches by keyword and pages by cursor, and a test replays
      a captured answer
- [ ] `since` is applied from a date the provider stands behind, and the Log
      says whether it publishes one
- [ ] The connector reads comments through `fetchReplies`, declares
      `canFetchReplies`, and stores them as `kind = 'reply'` rows under their
      video — through the shared parser, which US-020 proved reads every
      SocialCrawl `CommentList`
- [ ] `ReplyResult.partial` is reported from evidence, the same rule the other
      three connectors follow
- [ ] The Log records what one search and one comment page cost and returned,
      measured
- [x] **The Log says whether a TikTok comment is long enough to be a lead**,
      judged by reading them rather than by counting rows
- [ ] STACK.md and AGENTS.md record the fifth network as a decision, and that
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

- 2026-09-06T13:32+08:00 — Recommendation: **do not build the connector.**
  Reconsider if a monitor exists whose customers are consumers rather than
  engineers, because nothing here says TikTok has no intent — it says TikTok has
  no *this product's* intent, at a median of 19 characters. That is a different
  claim and the fixtures support only the second.

