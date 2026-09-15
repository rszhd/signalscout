---
id: US-137
title: Apify reads the comments under a LinkedIn post
type: feature
priority: p1
created: 2026-09-15T14:00+08:00
parent: US-020
area:
resolution: shipped
---

## Context

**LinkedIn is the one platform where no connector reads comments.** SocialCrawl's
LinkedIn connector was switched off in US-053 and never read them; Apify's
fetches posts and does not ask the actor for comments, though the actor can.
US-020 left one box open for exactly this — "the SocialCrawl LinkedIn
connector does the same, or the ticket records why it was left out" — and the
provider changed underneath it.

**A comment is a separate charge at the same price as a post**, $2.00 per
thousand, settled from the run's own total after the run ends. That last part
is the trap docs/sources.md records for this provider: a total read too early
prices every poll at a fraction of a cent. A comment fetch is a second run,
or a second phase of the same run, and its bill must be read the same
careful way.

**Whether a LinkedIn comment carries a lead is unmeasured.** On Instagram and
TikTok the comments hold everything and on Reddit they hold the experts. On
LinkedIn a comment under a B2B post is often the person with the problem
asking the poster how they solved it. That is the shape this product looks
for, and it is a guess until a capture shows one.

**The lent-keys plan polls LinkedIn daily**, US-134, and allows three queries
there. A thread per matched post on top of that is bounded by
`maxThreadsPerPoll` like every other platform, and it is the model calls that
cost, not the fetch.

## Acceptance

- [x] `fetchReplies` asks the comments actor for the comments under one post
      URL, waits for the run inside the call with a three-minute deadline, and
      reads the bill only once it has settled, the way `search` does
- [x] A comment's id, author slug, text, date and reply count are read. No
      field names a parent comment: `scrapeReplies: true` returned none for a
      comment claiming one, so every item is stored directly under the post
      and a claimed reply makes the thread partial
- [x] The permalink is the provider's own, a feed link carrying the comment
      URN. The owner opened one on 2026-09-15 and it landed on the comment
- [x] The actor has no paging: one run reads up to `maxItems`, fifty here, and
      a full page is partial
- [x] The parser replays `linkedin-fixtures/comments.json`, captured through a
      `--only=comments` mode. $0.026, $0.006 of it the comments
- [x] The monitor form reads the declaration through `canFetchRepliesFor`
- [x] US-020's LinkedIn box is closed, with a Log entry there naming Apify
- [x] No test spends money. 52 pass in the connector's file

## Notes

- Needs `APIFY_API_TOKEN` in `.env`. It is not on the development machine on
  the day this was written.
- The actor's comment input is documented on the actor's page at Apify. Read
  it before the capture; do not guess the field name from the post input.

## Log

- 2026-09-15T14:00+08:00 — Written. Third of five; blocked on a key.

- 2026-09-15T15:25+08:00 — **Built, $0.026 spent, one box open.** The comments
  actor is `harvestapi/linkedin-post-comments`, input `posts`, `maxItems`,
  `scrapeReplies`, read from its input schema rather than guessed.

  Three things measured. It bills `post-comment` at $0.002 and **no start
  event**: three comments cost $0.006 exactly, where the search actor's start
  costs $0.00005 whatever it finds. Three came back for a post claiming four,
  and the fourth — a reply under a comment, `engagement.comments: 1` — never
  arrived with `scrapeReplies` on, so a nested reply's shape is unproven. And
  the page is not in date order, so every row is tested against `since`.

  The replies step cannot hand a wait back the way a poll can, so the
  connector waits inside the call, five seconds a check, three minutes at
  most; the captured run took 6.5 seconds. A run past the deadline is
  abandoned to finish and bill on its own, the thread is re-opened next poll,
  and the error says so.

  The relevance search committed twelve company ids the scrubber had no rule
  for. They were scrubbed by hand, the manifest says so, and the scrubber now
  has the rule. The mode also overwrote `findings.json`, US-056's evidence,
  before it was told not to; that file was restored from git.

- 2026-09-15T15:32+08:00 — **Closed.** The owner opened the provider's comment
  link and it landed on the comment. Every box is true.
