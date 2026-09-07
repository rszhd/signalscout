---
id: US-053
title: A connector ships without being offered
type: feature
priority: p2
created: 2026-09-07T12:55+08:00
parent:
area:
resolution:
---

## Context

**A connector can be switched off, and LinkedIn is the first one.** The
mechanism is the ticket; LinkedIn is the first caller. Turning off a second
connector later must be one field on one definition, and no other file touched.

**LinkedIn costs $0.2030 for fifty posts, which is fifty times Reddit through
ScrapeCreators.** The owner read the per-fifty table on 2026-09-07 and decided
the platform is too dear to offer. One call is five credits for ten posts, so a
LinkedIn post costs about $0.0041 — ten times an X post and twenty-seven times
a Bright Data Reddit record.

**The decision is about the pair, not about the platform.** US-024 separated
those axes for this reason, and the switch belongs on the same axis. LinkedIn
through SocialCrawl is dear; LinkedIn through somebody else may not be, and
US-054 is measuring exactly that. So the connector is switched off, not
deleted: its file, its parser, its fixtures and `live:linkedin-poll` all stay,
and the platform comes back the moment a cheaper provider is proven.

**A platform with two providers must lose only the one that is off.** That is
the case the mechanism has to get right and LinkedIn cannot test, because it
has one provider. Reddit has three. Switching off one Reddit connector must
leave Reddit on the form, fetched by the others, and must not turn a recorded
choice into a silent fallback — `decideProvider` refuses a choice it cannot
run rather than replacing it, and a disabled connector is one it cannot run.

**Deleting the line from `builtInSources` is the wrong way to do any of it.**
It hides LinkedIn from the monitor form and leaves three doors open. The API
takes its platform list from the `posts.source` database enum, not from the
registry, so a `POST /api/monitors` naming `linkedin` is still accepted.
`startBlockers` reports nothing for a platform with no connector — that is
deliberate and documented — so the monitor reads as startable. Then the poll
calls `registry.only("linkedin")` and throws `UnknownSourceError` at 02:00. The
person who chose it never sees a refusal; they see a monitor that collects
nothing.

So the reason has to be a value that every screen and every write path can
read, rather than an absence they each have to infer.

**Two monitors in the development database already name LinkedIn** — US-028's
live poll monitor, and one called "Reddit" that watches Reddit, X and LinkedIn
together. Both are paused. The second is the case that matters: a poll of it
must collect Reddit and X and skip LinkedIn with a recorded reason, not fail
the job. A disabled connector is a decision, and a decision is not an error.

## Acceptance

- [ ] Any connector definition can carry the reason it is not offered, in one
      sentence. Nothing about the mechanism names LinkedIn
- [ ] Switching off a connector is that one field and nothing else: no list to
      edit, no screen to change, no test outside its own to update
- [ ] `socialCrawlLinkedIn` carries the reason, and is still exported, still
      built by its own tests, and still run by `live:linkedin-poll`
- [ ] A test switches off **one of the three Reddit connectors** and asserts
      Reddit is still offered, still polls through another provider, and that a
      recorded choice naming the disabled one is refused rather than replaced
- [ ] A test switches off every connector for a platform and asserts the
      platform disappears from the form and from the connections screen
- [ ] `POST /api/monitors` and `PATCH` refuse a monitor whose sources name a
      platform with no offered connector, and the message says why it is off
- [ ] The cost test refuses the same platform the same way, because
      `estimates.ts` reads the database enum too
- [ ] A poll of a monitor that already names LinkedIn collects its other
      platforms and skips LinkedIn, recording the reason; the job succeeds
- [ ] `docs/sources.md` gains the procedure beside its two existing lists:
      how to switch a connector off, and what happens to monitors naming it
- [ ] No behaviour changes for any connector that is still offered, and the
      only expected values that move are LinkedIn's

## Notes

- The prices this rests on are in `sources/providers/socialcrawl/linkedin.ts`
  and were read from socialcrawl.dev/pricing on 2026-09-05.
- [US-054](US-054-linkedin-is-measured-at-the-other-provider.md) is the way
  back. If ScrapeCreators returns useful LinkedIn posts at a credit a call,
  this ticket's switch is flipped for that connector rather than reverted.
- Do not remove `linkedin` from `sources/platforms.ts` or from the `posts.source`
  enum. The platform is real, the posts are stored, and US-028's rows must stay
  readable.
- **A per-deployment override is out of scope, deliberately.** This switch is
  the build's decision, made once for everybody, and an environment variable
  that reversed it would be a second answer to the same question — the shape
  US-026 removed when it deleted `REDDIT_PROVIDER`. If a self-hoster ever needs
  to run a connector this build does not offer, `source_providers` is the
  precedent: a row, chosen on a screen. Nobody has asked yet.
- AGENTS.md and STACK.md both describe LinkedIn as live. Both need the
  correction in the same commit, or the next reader builds on a platform that
  is off.

## Log

- 2026-09-07T12:55+08:00 — Written after the owner read the cost of fifty
  posts per connector and asked for LinkedIn to be disabled rather than
  removed.
- 2026-09-07T13:04+08:00 — The owner asked that the switch not be built for
  LinkedIn alone. Rewritten so the mechanism is the ticket: the Reddit case
  proves a platform survives losing one of its providers, which LinkedIn
  cannot test with one.
