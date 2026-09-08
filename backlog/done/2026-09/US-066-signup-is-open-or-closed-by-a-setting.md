---
id: US-066
title: Signup is open or closed by a setting
type: feature
priority: p1
created: 2026-09-08T03:20+08:00
parent: US-017
area:
resolution: done
---

## Context

US-017 shipped one account per instance and closed signup behind it. That was
right for the product as PLAN.md described it — self-hosted, one person, teams
deferred to a possible Pro feature.

**The owner reversed it on 2026-09-08.** There is a cloud version, and a cloud
version needs registration. A self-hosted instance turns it off. This is a
decision, not an oversight, and US-017's rule is superseded rather than broken:
the reason that rule existed still holds for the deployment it was written for.

The dangerous half is unchanged and it is why this is one variable rather than a
removed check. US-017's Context: *"A default password, or an open signup form on
a public address, gives the instance away to whoever finds it first."* Every
instance already running is self-hosted, so **the default has to be closed.** An
upgrade that silently began accepting registrations would be exactly the failure
US-017 was written to prevent, arriving as a version bump nobody read the notes
for.

One consequence belongs in the open, because it is not this ticket's to fix.
Provider keys are the *instance's* — `source_credentials` is keyed by provider
alone, and the lookup falls back to `BRIGHTDATA_API_KEY` in the environment. So
a stranger who registers on an instance with signup open polls on the owner's
key and against the owner's bill. Opening signup on a real cloud instance needs
US-017's deferred credentials box closed first. This ticket ships the switch;
it does not make the cloud tier safe on its own.

## Acceptance

- [x] One environment variable turns signup on and off, and it is documented in
      `.env.example` and in compose
- [x] The default is closed, so an instance that upgrades without reading
      anything keeps US-017's behaviour
- [x] With signup closed, the first run still creates one account and the second
      attempt is refused by the server, not hidden by the screen
- [x] With signup open, somebody who is not signed in can create an account from
      the login screen, and the screen offers the way to it
- [x] Only the first account adopts the rows that predate the accounts, whatever
      the setting
- [x] A test drives both settings, including the refusal, against real Postgres

## Notes

- Supersedes the "signup closes afterwards" half of
  [US-017](US-017-a-self-hosted-instance-has-one-account.md). The rest of that
  ticket — the gate, the scoping, sessions — is untouched.
- `invite` is the obvious third value and is deliberately not built. Nobody has
  asked for it, and a self-hoster sharing with one colleague is a different
  ticket from a cloud tier taking registrations.
- Read docs/accounts.md before changing the wording on the login screen.

## Log

- 2026-09-08T03:20+08:00 — Written after the owner reversed US-017's
  single-account rule: "we have cloud version, self hosted can just disable
  signup", then "need to have variable in .env to turn off/on signup".
- 2026-09-08T03:32+08:00 — `AUTH_SIGNUP`, `closed | open`, default `closed`.
  An enum rather than a boolean, because `invite` is the obvious third value
  and `AUTH_SIGNUP=false` would have to become something else the day somebody
  asks for it.
- 2026-09-08T03:33+08:00 — **The default is the one judgement call here, and it
  goes against the literal request.** The owner said self-hosted "can just
  disable signup", which reads as open by default. It ships closed. Every
  instance running today is self-hosted, and the upgrade is where that matters:
  a version bump that silently began accepting registrations is the exact
  failure US-017 exists to prevent, arriving through a release note nobody
  read. Flipping it is one word in `env.ts` if the owner disagrees.
- 2026-09-08T03:34+08:00 — `/api/auth-status` answers two questions where it
  answered one. `firstRun` decides between "set this up" and "sign in";
  `signUpOpen` decides whether to offer a new account at all. They used to be
  the same boolean and are not any more — an open instance with an owner is
  `firstRun: false, signUpOpen: true`.
- 2026-09-08T03:35+08:00 — **The claim guard is the part that would be worst to
  get wrong.** `claimUnownedRows` ran for every created user, which was correct
  only because no second user could exist. With signup open one can, and a
  stranger who registers inheriting the owner's monitors is the worst bug a
  shared instance could have. `isOnlyAccount` is now the guard, and a test
  registers a second person and checks both the row's owner and that their own
  screen is empty.
- 2026-09-08T03:36+08:00 — On the screen: the switch between the two forms is
  **absent** where signup is closed, not disabled. An offer that refuses is
  worse than no offer, because somebody fills the form in before they meet the
  refusal. The sign-in subtitle lost the words "This instance is private",
  which were true of a self-hosted box and false of a cloud tier; one sentence
  now serves both, and the assertion moved with the wording rather than the
  other way round.
- 2026-09-08T03:38+08:00 — Closed. Driven live against the built app,
  `NODE_ENV=production`, both settings. With `AUTH_SIGNUP=open`: status
  `firstRun:true signUpOpen:true`, first account 200, **second account 200**,
  status then `firstRun:false signUpOpen:true`. With the variable unset: first
  account 200, **second account 403** with the instance's own sentence, status
  then `firstRun:false signUpOpen:false`. 1,400 tests pass.

  What is unproven is the same thing US-017 leaves unproven: no real browser
  has rendered either form. The switch between them is driven through jsdom.
