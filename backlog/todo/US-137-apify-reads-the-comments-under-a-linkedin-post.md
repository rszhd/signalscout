---
id: US-137
title: Apify reads the comments under a LinkedIn post
type: feature
priority: p1
created: 2026-09-15T14:00+08:00
parent: US-020
area:
resolution:
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

- [ ] `fetchReplies` asks the actor for the comments under one post URL, and
      reads the run's bill only after the run has ended, the way `search`
      already does
- [ ] A comment's id, author, text, date and parent comment are read from the
      actor's output, and the ticket records which of those the actor does not
      return
- [ ] A permalink is built or read, and one was opened in a browser and
      reached the comment
- [ ] The actor's paging, if it has any for comments, is followed up to
      `maxPagesPerThread`; if it returns the whole thread in one run, the run's
      comment limit is passed and `partial` is set when the thread is larger
- [ ] The parser replays a captured fixture from `apify/linkedin-fixtures/capture.mjs`,
      extended with a comments mode. About $0.05
- [ ] The monitor form's per-platform reply note reads the new declaration
- [ ] US-020's open LinkedIn box is closed by this ticket, with a Log entry
      there saying which provider answered
- [ ] No test spends money

## Notes

- Needs `APIFY_API_TOKEN` in `.env`. It is not on the development machine on
  the day this was written.
- The actor's comment input is documented on the actor's page at Apify. Read
  it before the capture; do not guess the field name from the post input.

## Log

- 2026-09-15T14:00+08:00 — Written. Third of five; blocked on a key.
