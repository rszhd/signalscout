---
id: US-046
title: A reply is posted from the inbox
type: feature
priority: p2
created: 2026-09-06T15:12+08:00
parent: US-040
area:
resolution:
---

## Context

**This reverses a decision, and the reversal is the first thing to say.**
PLAN.md's *What we are NOT building* list holds "social publishing", and
US-040's Notes say it in more words: *no OAuth, no write scope, no stored
account credential for any network*. US-040 was written to end at the
clipboard. The owner has since asked for the button that posts, so this ticket
is where that decision lives. Anyone who reads US-040 and this one in that
order will find a decision rather than a contradiction, and PLAN.md's list must
be edited by whoever builds this — a NOT list that quietly stops being true is
worse than no list.

The rule that survives is narrower and it still matters: **this product posts
only what a person has read and pressed send on.** No queue, no schedule, no
batch. US-040 generates the draft; this ticket adds one send, from the inbox,
for one match, after a person has seen the text. That is the difference between
a reply tool and the flooding machine PLAN.md's list exists to prevent.

**The request names one mechanism and there are two, with very different
consequences.** They should not be built as one thing.

*Official authorisation.* The platform's own OAuth, a write scope, a token the
person can revoke from their account settings, and a rate limit the platform
publishes. This is the mechanism a person can undo. It is also the one that
costs money and paperwork, and the availability is uneven — AGENTS.md records
that Reddit ended self-serve app registration in November 2025, and that X's
own API is pay-per-use with no free tier. Whether each platform can be reached
this way is the first thing this ticket has to establish, per platform, from
the platform rather than from memory.

*A session token pasted from a browser.* This is what the request literally
asked for, and it should be built only if the first mechanism cannot be. A
session cookie is not a scoped credential. It is the whole account: it can
read private messages, change the password, and delete the account, and no
platform lets a person revoke one without ending every session they have. It
carries no rate limit anyone has published, automated use of it violates the
terms of every network here, and the normal consequence is the account being
banned — the account being the person's own audience, which is the asset this
feature exists to use. It also cannot be tested honestly: a fixture proves our
parser and nothing about what the platform does to an account that posts this
way.

**None of that makes it wrong to build.** This is self-hosted, the account is
the owner's own, and a person replying by hand through a browser is doing the
same thing more slowly. But the ticket must not let the two mechanisms be
confused at build time, and the screen must not let them be confused at use
time: a person pasting a session token is taking a risk that a person clicking
"Sign in with X" is not, and they have to be told which one they are doing, in
the sentence where they do it.

**Read `docs/secrets.md` before writing any of this.** The credential store
exists, it is encrypted, and it is keyed by provider. A posting credential is
a different risk from the read keys it holds today, and the difference is worth
naming in that document: a data provider key spends money, and a posting
credential spends reputation. They should not share a screen without saying so.

**The failure to design against is the accidental send.** Everything else here
costs money; this costs a public message under the person's own name that they
cannot fully unsend. Two consequences: the send is never the default action of
any control, and nothing automatic — no retry, no queue drain, no "resume
after restart" — may ever produce a post. A send that fails is reported to the
person, and they press it again or they do not.

## Acceptance

- [ ] PLAN.md's *What we are NOT building* list is edited, so "social
      publishing" no longer reads as a rule this product follows. The new
      boundary is written in its place: one reply, one person, one press
- [ ] The Log records, per platform, whether an official write API exists,
      what it costs, and what it requires — asked of the platform, not
      remembered. Reddit and X are the two the repository already has findings
      about, and both findings are about *reading*
- [ ] A person can connect a posting identity for at least one platform, and
      the screen says which mechanism they are using and what it can do
- [ ] A pasted session token, if it is built at all, is stored through the
      same encrypted store as every other credential, and never appears in a
      log line, an API response or an error message
- [ ] The screen that accepts a session token says, in plain words at the
      point of pasting, that it is the whole account and that automated use
      may get the account banned. Not a tooltip, not a link
- [ ] A posting credential is visibly separate from a data-provider key,
      because one spends money and the other spends reputation
- [ ] Sending is one explicit action on one match, after the draft has been
      shown. It is never the default button, and never reached by keyboard
      alone from the draft
- [ ] Nothing sends automatically. No retry, no queue, no resume after
      restart, no scheduled send. A failed send is reported and left to the
      person
- [ ] What was sent, when, and to which post is recorded against the match, so
      a person can see they have already replied and does not reply twice
- [ ] The inbox shows that a match has been replied to
- [ ] A platform with no posting credential shows the draft and the copy
      action, exactly as US-040 leaves it. Adding this feature must not remove
      the one that works everywhere
- [ ] `docs/secrets.md` gains a section on posting credentials: what they are,
      why they differ from read keys, and how to revoke one per platform
- [ ] Tests cover our half only, and the ticket says so: no test posts
      anything, and the suite cannot prove what a platform does to an account

## Notes

- Depends on [US-040](US-040-a-draft-reply-the-person-sends-themselves.md) for
  the draft. Building this first would give a person a send button and nothing
  to send.
- **Order the work by mechanism, not by platform.** Establish what official
  authorisation is available before writing any session-token code. If X's
  write API is affordable and Reddit's is reachable, the second mechanism may
  not be needed at all, and it is the expensive half to get right.
- The registry splits platform from provider, and this axis is a third thing
  again: a *posting identity* is the person's own account, and it is not a
  provider and not a platform key. Do not force it into `source_credentials`
  without reading how that table is keyed — it is keyed by provider, and two
  people's X accounts are not two providers.
- One reply per match is the rule that makes the recording simple. If threading
  a conversation is ever wanted, it is a different ticket with a different
  shape, and it is much closer to the thing PLAN.md's list was protecting.
- A model refusal reaching the screen matters more here than in US-040. A model
  that declines to write a sales reply is telling the person something, and
  here they can act on it in one press.

## Log

- 2026-09-06T15:12+08:00 — Written at the owner's request, which was to allow
  a sign-in or a session token so a reply can be sent from the inbox. It is
  recorded as a reversal of US-040's boundary and of PLAN.md's NOT list rather
  than as a new feature, because that is what it is. The two mechanisms the
  request conflates are separated here deliberately: one is revocable and
  scoped, the other is the whole account, and the second is the one the request
  named.
