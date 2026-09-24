---
id: US-396
issue: 114
title: A match records that the person replied
type: feature
priority: p1
created: 2026-09-24T22:04+08:00
parent:
area:
resolution:
---

## Context

**The inbox forgets the one thing the person did.** The flow ends at the
clipboard (US-040): a draft is copied, pasted into the platform, and posted.
Back in the inbox the match looks exactly as it did before — the only marks are
*Saved* (US-043) and a verdict (US-012), and neither says "I answered this".
A person working through fifty matches cannot tell which ones they have
already replied to, and the likely failure is replying to the same thread
twice, in public, under their own name.

**The mark is set by the person, and the product asks at the right moment.**
A *Mark as replied* button in the reading pane sets it for any match, however
the reply was written. When the person presses *Copy* on a draft, the panel
asks "Did you post it?" with the same action beside the question. The copy
itself sets nothing: a copy is not a post, and a mark the person did not give
would be a mark they learn not to trust.

**This is carved out of US-046, not a rival to it.** US-046 posts from the
inbox and lists "the inbox shows that a match has been replied to" among its
checks. That half needs no OAuth, no posting credential and no edit to
PLAN.md's NOT list, and it serves the replies US-046 will never see — the ones
written in the platform's own window. So it ships here first, and US-046 sets
the same field when it sends rather than inventing a second one.

**Two alternatives were weighed and left out.** Detecting the reply on the
platform (re-reading the thread on the next poll and looking for the person's
handle) costs a metered read per match, needs a handle per platform, and some
providers do not return every comment, so it would be wrong some of the time.
A lead status (new → replied → in conversation → won) is a CRM, and PLAN.md
says this product is not one.

**What this is and is not.** Like `saved_at`, it is the person's intention and
not a judgement about the model: it is not a verdict, it does not set *Good
lead*, and it survives a re-classification untouched. A reply is a strong
signal about the lead, and a later scoring ticket may read it; this ticket
only records it.

## Acceptance

- [ ] `matches` gains a nullable `replied_at`, the same shape as `saved_at`,
      with a migration. Null means not replied
- [ ] A route sets and clears it for one match the caller owns, and the match
      shape the API returns carries it
- [ ] The reading pane has a *Mark as replied* button that toggles the mark
      and reads as pressed when it is set, beside *Save for later*
- [ ] Pressing *Copy* on a draft shows "Did you post it?" with a
      *Mark as replied* action. The copy alone never sets the mark
- [ ] A replied match stays in the list, and its card shows a *Replied* badge
- [ ] The filters offer hiding replied matches, and the list and the export
      honour it the same way, through the one filter query
- [ ] Marking a match replied does not change its verdict, its saved state or
      its place in the list
- [ ] Both applications show the button, the question, the badge and the
      filter. The cloud inbox is changed in the same release (see Notes)
- [ ] Tests cover the route (owner only, set and clear), the migration, the
      filter, and that *Copy* alone leaves the match unmarked

## Notes

- Related: [US-046](US-046-a-reply-is-posted-from-the-inbox.md) should set
  `replied_at` when it sends, and keep what was sent in its own record. Its
  acceptance line about the inbox showing a reply is met by this ticket.
- Follows the pattern of US-043: `savedAt` in
  `packages/pipeline/src/db/schema/matches.ts`, `setMatchSaved` in the
  pipeline, `PUT /api/matches/:id/saved` in `apps/api/src/matches.ts`.
- The button and the question live in shared components,
  `packages/ui/src/MatchDetail.tsx` and `packages/ui/src/ReplyDraft.tsx`, so
  they reach both applications. The badge goes on `MatchCard`, and the filter
  on `InboxFilters`.
- The cloud inbox (`signalscout-cloud/apps/web/src/Inbox.tsx`) builds its own
  query and list, so it needs the filter and the save-style handler by hand.
  Build both against the working copy and release once.
- Open question, decided here by default and open to change: a replied match
  stays in the list rather than leaving it the way a *Not relevant* one does,
  because a replied lead is still a lead and the conversation may continue.

## Log

- 2026-09-24T22:04+08:00 — Written at the owner's request, after a walk
  through the inbox flow showed nothing records a reply. Option B of five was
  chosen: a mark the person sets, with a question after *Copy*.
