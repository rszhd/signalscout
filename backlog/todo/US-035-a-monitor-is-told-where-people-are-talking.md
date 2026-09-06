---
id: US-035
title: A monitor is told where people are talking
type: spike
priority: p2
created: 2026-09-06T11:40+08:00
parent:
area:
resolution:
---

## Context

**The query generator guesses at subreddits, and the repository already says
so.** `ai/queries.ts` asks a model to name the communities a monitor should
watch, and the model answers from memory. AGENTS.md records what that produced:
five names for the example monitor, four of which were verified by opening them
by hand, and one proven only because a collection returned fifty posts from it.
The honest sentence there is *"a name that exists can still be the wrong place
to look"*.

That is the weakest link in monitor creation. Everything downstream is measured
— the queries are held to a per-platform word limit, the cost test prices a
month before a monitor starts, US-031 proved a keyword inside the right
subreddit returns seven on-topic posts where the same words across Reddit return
a dog with a skin issue. All of it rests on somebody having named the right
subreddit.

**SocialCrawl publishes an endpoint that answers the question with data.**
`/v1/reddit/omni-search` takes one keyword, runs the Reddit search, expands the
top threads' comments, and returns a roll-up of **which subreddits are
talking**: each row is `{ name, subscribers, weekly_active_users, thread_count,
tone }`. Read from the free catalogue on 2026-09-06; nothing here has called it.

Two of those numbers are worth more than they look, and the provider is careful
about them. `subscribers` is who joined; `weekly_active_users` is who took part
in the last week, and it is **not a subset** — Reddit does not require joining
to post. The guide's own example: r/keyboards had 188,869 weekly active against
147,416 subscribers, while r/technology is far lower. So they are two
independent signals, size against liveliness, and never a ratio.

**This is a monitor-creation tool, not a poll.** It expands comments before
anything decides a thread is worth reading, which is the opposite of how this
product spends money: US-034's YouTube run had triage drop 60 of 71 videos, so
eleven threads were opened rather than seventy-one. Its comments are *top*
comments rather than newest, so US-020's date window could not be applied to
them either. Using it per poll would be paying to expand threads the pre-filter
would have refused.

Used once, when a person creates a monitor, it is a different thing: it
replaces a guess with a measurement, and the cost lands on the one call a person
is already waiting through.

**What is unmeasured, which is everything.** The endpoint has never been
called. The provider's own guide warns that Reddit search there is the slowest
on its API — a 10 to 12 second median with a tail past 30 — and that *"relevance
is loose: a VoC sweep, not precision ranking"*. A loose sweep may still name the
right communities; that is exactly what this ticket has to find out rather than
assume.

## Acceptance

- [ ] `/v1/reddit/omni-search` is called once for PLAN.md's example monitor,
      and the whole answer is captured as a fixture with identity scrubbed
- [ ] The Log records what it actually cost after refunds, and how long it took
      against the guide's warning of a 10 to 12 second median
- [ ] The Log lists the subreddits it named, and says **how many of them are
      the right place to look**, judged by reading them rather than by counting
      rows
- [ ] The Log compares that list against the five `ai/fixtures/query-plan.json`
      holds, which the model invented from memory. Same monitor, two methods,
      one table
- [ ] The Log says whether `weekly_active_users` and `subscribers` disagreed on
      any row, because the guide says they can and a ratio would be wrong
- [ ] The Log states a decision in one sentence: use this at monitor creation,
      or keep the model's guess
- [ ] If the decision is to use it, a separate ticket wires it into the monitor
      form. This one does not change the form

## Notes

- Depends on nothing. It needs a SocialCrawl key, which this deployment holds.
- Metered: 1 credit per search page plus 1 per thread expanded, minimum 5. At
  8,118 micro-dollars a credit that is $0.041 to $0.073 for one call. A failed
  thread is not billed and the unused thread ceiling is refunded, so the
  measured cost may be under the minimum.
- `threads` is 1 to 8 and defaults to 8. Send a smaller number first: the
  question is which subreddits are named, and the thread expansion is the part
  that costs.
- `tone` is one LLM label per community. It degrades to null with a `_warnings`
  line rather than a silent blank, which is worth asserting if it is ever read.
- A small share of rows can carry a null `subscribers` or
  `weekly_active_users`; both are filled from the same source as
  `/v1/reddit/subreddit/details`. Null means the provider could not say.
- Do not use this per poll. The Context says why, and a later reader looking for
  a cheap way to collect comments will find this endpoint before they find that
  paragraph.
- Read the fixture before committing it. Two captures in this repository leaked
  identity on their first run, both caught by an audit rather than by reading.

## Log

- 2026-09-06T11:40+08:00 — Written after the owner asked what omni-search is.
  The answer is that it is a poor fit for polling and a good fit for the one
  thing this product currently guesses at, so the ticket is scoped to monitor
  creation and to measuring rather than building.
