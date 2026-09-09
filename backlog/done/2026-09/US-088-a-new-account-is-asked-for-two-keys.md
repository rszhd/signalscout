---
id: US-088
title: A new account is asked for two keys
type: feature
priority: p2
created: 2026-09-09T14:05+08:00
parent: US-017
area: web
resolution: done
---

## Context

**A new account lands on an empty projects list, and nothing says what to do
first.** The product cannot collect a post without a provider key and cannot
score one without a model key, so an account holding neither can walk the whole
monitor form and reach step 3, where US-085 now stops it: no platform is
ticked, because no platform has a key. That refusal is correct and it arrives
four screens too late.

The two keys live on two screens — Connections and Models — and both are in the
sidebar. Neither is where a person who has just registered is looking, and
neither says it is the first thing to do.

**Onboarding asks for exactly two things: one provider key and one model key.**
Not every provider, not the four model jobs, not a project and not a monitor.
One of each is the smallest state in which this product does anything at all,
and everything past it is a decision a person can make later on the screen that
owns it.

**It stores nothing new.** Both writes are the routes that already exist —
`PUT /api/connections/:provider` and `POST /api/models/keys` — so a key pasted
here is tested with the provider before it is stored, exactly as it is on the
screens it comes from. The first model key becomes the account's default on its
own, through `adoptDefault`, so pointing a job at it is not part of this.

**Whether setup is finished is derived, not recorded.** There is no
"onboarded" flag and no migration. The screen reads `/api/connections` and
`/api/models` and asks two questions of the answers: is any provider ready, and
can the scoring job run. A flag would be a second copy of the truth, and it
would go wrong in the direction that hurts — an account that deleted its keys
would be told it is set up.

**Two consequences fall out of deriving it, and both are wanted.** A
self-hosted instance whose keys are in `.env` is already set up, so it never
sees this screen. And a person who skips is not remembered as having skipped:
the address they skip to is a real screen, and the next time they land on the
root address the setup screen is there again, because the product still cannot
run.

**It is a gate, not a route.** `App.tsx` renders it in place of the whole
application while either key is missing, the way it renders the login while
nobody is signed in. The first attempt made it a route the catch-all redirected
to, with a "Skip for now" link out of it; the owner registered an account,
stepped around it in one click, and said so. A redirect that can be skipped is
not onboarding — the missing key then arrives later, on the monitor form, as a
refusal nobody can act on.

## Acceptance

- [x] An account with no provider key and no model key is shown the setup page
      in place of the application, whatever address it asks for.
- [x] An account that has both never sees it.
- [x] Pasting a provider key saves it through the connections route, so a key
      the provider refuses is not stored and the refusal is the provider's own
      sentence.
- [x] Pasting a model key saves it through the model key route, with the model
      it is tested against prefilled from the build's recommendation.
- [x] A step whose key is already present — stored or in the environment — is
      shown as done rather than asked for again.
- [x] An instance with no `ENCRYPTION_KEY` says so and asks for neither key.
- [x] There is no way past it but the two keys or signing out.
- [x] An account whose setup could not be read is let through rather than
      locked out.

## Notes

Nothing on the server changes. No route, no schema, no migration.

The provider step offers every provider this build registers, in registration
order, which US-055 recorded is the order every screen shows them in.

## Log

- 2026-09-09T14:05+08:00 — Written.
- 2026-09-09T15:44+08:00 — Done. One screen, one route in the table, and two
  lines changed in `App.tsx`. Nothing on the server moved: the two saves are
  `PUT /api/connections/:provider` and `POST /api/models/keys`, so a key is
  tested with the provider before it is stored and the sentence a person reads
  when it is refused is the provider's own, here as on the screens these
  routes belong to.

  **The catch-all is the whole routing change.** `*` sent every unmatched
  address to the projects list; it sends it to the setup screen now, and the
  setup screen sends an account holding both keys on to the same projects
  list. So the only address whose behaviour moved is the one a new account
  arrives on — the login sits on the root address and signing up reloads it —
  and nothing else in the table was touched.

  **Two rules are the whole screen and both are covered by a mutation.**
  Making `hasProviderKey` always true turns three cases red, and so does
  `hasModelKey`. The second one is the fallback the server computes for the
  scoring job rather than a count of stored keys, which is why a self-hosted
  instance with `AI_API_KEY` in `.env` reads as finished and is never asked.

  **One acceptance box was reworded rather than ticked as written.** It asked
  that the forwarded address leave nothing in the history. The redirect does
  use `replace`, but the claim cannot be tested and is not observable: with a
  push, going back lands on the setup screen, which immediately forwards
  again, so the two behaviours differ only by a flicker. A test written for it
  passed with `replace` removed, so it was deleted rather than kept as an
  assertion that cannot fail.

  Eight new cases in `Welcome.test.tsx` and two in `App.test.tsx`, whose fetch
  stub now describes an account that is set up or not. The whole suite passes:
  1,619 tests in 94 files.

  Unproven: no real browser has rendered this screen. It is driven through
  jsdom, like every screen here.
- 2026-09-09T16:02+08:00 — Reversed and rebuilt, on the owner's report. The
  first version was a route: the catch-all redirected to `/welcome`, and the
  page carried a "Skip for now" link. The owner registered, was moved to a page
  asking for a key, skipped it in one click, and did whatever else — which is
  the whole of what this ticket exists to prevent.

  **It is a gate now.** `App.tsx` renders `Onboarding` in place of the
  application while either key is missing, which is the shape the login already
  had ten lines above it and the shape this should have had from the start. No
  address reaches past it, there is no route to navigate to, and the sidebar —
  which is the only set of links out — renders behind the gate rather than
  beside it. `paths.welcome` is gone again.

  **Both keys are on one page**, asked for together rather than one after the
  other, because two steps shown one at a time is what made the first version
  read as a redirect to somebody who already held one of the keys. A step that
  is answered shows what answered it — the provider's name, or the key's name
  and mask — rather than disappearing.

  **Two ways out, and both are deliberate.** Signing out is on the page,
  because every other screen is behind the gate and so is the sidebar's own
  sign-out button; without it, somebody signed in to the wrong account on a
  shared machine is stuck. And **a failed read opens the gate**: if
  `/api/connections` or `/api/models` does not answer, the application is shown
  as normal. Locking somebody out of their own inbox over one failed request is
  worse than letting an unconfigured account through, which the monitor form
  and every poll already refuse with a reason.

  `Welcome.tsx` became `Onboarding.tsx`, and its eight tests were rewritten
  against the new shape: the page takes the two views as props, because
  `App.tsx` has already read them to decide whether to show it and a second
  read could disagree with the first. `App.test.tsx` owns the gate itself — the
  setup page replaces the application at five different addresses with no
  navigation links on the page, and an unreadable setup does not gate. The
  whole suite passes: 1,620 tests in 94 files.

  Still unproven: no real browser has rendered it. The Chrome extension was not
  connected, so this is jsdom and a check that Vite compiles both modules.
