---
id: US-092
title: An address is verified before an account is used
type: feature
priority: p1
created: 2026-09-09T20:10+08:00
resolution: shipped
---

## Context

**Anybody can register with anybody's address.** US-066 opened signup for the
cloud version, and the sign-up form asks for an email nothing checks. Three
things follow. A person can take an address they do not own — including one
somebody else is about to use — and hold it for ever, because the column is
unique. US-072 gives every new account seven free days, and an address nobody
has to reach is a trial anybody can mint again with one keystroke. And US-016
sends digests to that address, so the product's own mail goes to a stranger's
inbox on the first match.

**A verification requirement with no transport is an instance nobody can sign
in to.** `auth.ts` has said so since US-017, in the comment beside
`requireEmailVerification: false`, and that reasoning is still right. The
common install has no SMTP at all: the digests are optional, a person
configures them after they are already inside, and turning verification on
everywhere would lock the owner out of a machine they run for themselves.

**So the requirement is a setting, and it cannot be set without mail.**
`AUTH_EMAIL_VERIFICATION` is `off | required`, default `off`, which is
`AUTH_SIGNUP`'s rule and `BILLING_MODE`'s reason: every instance running today
is self-hosted, and a version bump that quietly began refusing to sign anybody
in is the upgrade nobody would forgive. `required` makes the SMTP variables
required and the process refuses to boot without them — `BILLING_MODE=stripe`'s
shape exactly, and for the same class of failure. The variables are the ones
US-016 already declares: one instance, one mail sender.

**An account that exists already is verified by fiat.** Every row in `users`
today carries `email_verified = false`, because nothing has ever written it.
Turning the setting on without a migration would refuse every existing account
on the instance, the owner's included, on the first restart after the upgrade.
They registered before the rule existed and cannot be asked retroactively.
Migration 0053 marks them, and on a fresh database it touches nothing.

**Refusing a sign-in is where a new link comes from.** Better Auth answers an
unverified sign-in with 403 `EMAIL_NOT_VERIFIED` and re-sends the message on
the way out, so a person whose link expired signs in again to get another one.
That is the whole resend path, and it needs no route of its own.

**The screen has to say two things it has never said.** A sign-up under this
setting returns no session — `token: null`, no cookie — so `Login.tsx`
reloading on success would drop the person back on the form with nothing
explaining why. And a duplicate address answers a *generic success* rather than
"that is taken", on purpose, because telling a stranger which addresses are
registered is the enumeration the setting exists to stop. Both answers are
therefore the same sentence: check your email.

## Acceptance

- [x] `AUTH_EMAIL_VERIFICATION` is declared in `env.ts` and `.env.example`,
      `off | required`, default `off`.
- [x] With it `off`, nothing changes: sign-up signs a person in, and no mail is
      sent.
- [x] With it `required` and no SMTP configured, the process refuses to boot
      and names every missing variable at once.
- [x] With it `required`, sign-up writes the account, sends a link and creates
      no session.
- [x] Signing in as an unverified account is refused, and sends a fresh link.
- [x] Opening the link verifies the address and signs the person in.
- [x] An expired or tampered link lands back on the login screen with a
      sentence saying so, rather than a blank page.
- [x] Migration 0053 marks every account that existed before this as verified,
      and is named in `meta/_journal.json`.
- [x] The sign-up form says to check the email, and says the same thing for an
      address that is already registered.
- [x] docs/accounts.md holds the setting, the failure it protects against, and
      the SQL for verifying an account by hand when mail is broken.
- [x] The suite passes, and lint, typecheck and build are clean.

## Notes

The transport is US-016's. `createNotificationTransport(env).email` is null
when SMTP is not configured, which is the same question the boot check asks, so
the two cannot disagree.

`emailVerification.expiresIn` is 24 hours rather than the library's default
hour. A link that dies while somebody is at lunch is a support request, and the
sign-in path re-sends anyway.

`sendOnSignIn` is what makes the refused sign-in send a replacement, and it is
not on by default in the library. Without it the refusal is a dead end: there
is no resend route and no reset, so a person whose link expired has nothing
left to press. It is not a way to mail a stranger — a wrong password is refused
before the message goes out, so a link travels only to an address whose
password the sender already knows.

**A live run proved our half and refused at the provider.** See the Log. The
transport, an arriving message and a link opened in a browser are still
unproven, and the reason is a wrong key rather than anything in this code.

## Log

- 2026-09-09T20:10+08:00 — Written.
- 2026-09-09T20:45+08:00 — Done. `auth/verification.ts` holds the mode and the
  refusal; `auth/verification-email.ts` holds the message.
  `CreateAuthOptions.sendEmail` is one optional field rather than a mode beside
  a transport, so "verification required, no way to send" cannot be described —
  `requireEmailVerification` is `sendEmail !== undefined`. `server.ts` builds
  the sender from US-016's transport, and `start.ts` asks the same question
  before the port is bound.

  Two library behaviours were found by running it rather than by reading it.
  `sendOnSignIn` defaults to false, so the first version refused an unverified
  sign-in and sent nothing — a dead end, caught by the test that asserts the
  resend. And a sign-up for an address that already exists answers a *generic
  success* under this setting, which is right: the screen shows the same "check
  your email" for both, and no second link is sent to the real owner.

  Migration 0053 marks the accounts that predate the rule, and it ran against
  the development database: three accounts, all now verified, nobody locked
  out.

  `compose-environment.test.ts` caught the setting missing from
  `docker-compose.yml`. A variable named nowhere in that file never reaches the
  container, so `AUTH_EMAIL_VERIFICATION=required` in a `.env` would have been
  read by nothing — the same silent shape `BILLING_MODE` had.

  Tests: `auth/verification.test.ts` for the rule and the message,
  `apps/api/src/auth.test.ts` for six cases through real Postgres and the real
  library, `start.test.ts` for the boot refusal reaching `startApi` before the
  worker starts, `server.test.ts` for the sender, and `Login.test.tsx` for the
  three screen states. Two mutations were confirmed red: making
  `requireEmailVerification` false failed three API cases, and making the
  default `required` failed the sender case. The whole suite passes — 96 files,
  1,656 tests — and lint, typecheck and build are clean.

  Unproven: no real message has been sent. Every test captures `sendEmail`, so
  the SMTP transport, the Resend account and a link opened in a real browser
  are all untested.

- 2026-09-09T22:20+08:00 — Ran it live against the running dev instance, and
  the mail server refused.

  **Our half works in a real process.** The API had already started with
  `AUTH_EMAIL_VERIFICATION=required`, which is the boot check passing. A real
  `POST /api/auth/sign-up/email` answered **200 with `token: null`**, set no
  cookie, and wrote the account with `email_verified = false`. That is the
  whole shipped behaviour, outside the suite.

  **Resend refused the credentials.** `SMTP_PASSWORD` in `.env` starts `sk-`
  and is 35 characters; a Resend key starts `re_`. Their API answers
  `API key is invalid`, and a direct `nodemailer.verify()` against
  `smtp.resend.com:465` answers **535 Authentication credentials invalid**. So
  no message was sent, and inbox delivery stays unproven for the reason US-016
  already records.

  **That refusal found the gap worth fixing.** The sign-up still answered 200.
  Better Auth awaits the send, catches whatever it throws, and logs
  `Failed to run background task` — which names neither mail nor the account.
  So the person is told to check an inbox nothing reached, and the operator's
  only signal says nothing they can act on. **A broken mail server and a
  working one produce the same response.**

  The request still answers 200, and that stays. The account is written before
  the send, so refusing would report a failure that did not happen, and a second
  attempt meets the generic duplicate answer. The repair is the log: the sender
  wrapper now catches, logs at error level naming the address and saying the
  account cannot sign in until the mail is sent, and rethrows.
  `auth.test.ts` asserts that line, and lowering it to `debug` turns the case
  red.

  Left behind: one probe account, `resz.undersky+ssverify@gmail.com`, in the
  development database. It cannot sign in, which is the feature working.

- 2026-09-09T22:26+08:00 — Re-ran it with a real Resend key. **The message
  left.**

  `nodemailer.verify()` against `smtp.resend.com:465` now answers that the
  credentials are accepted, where the old key answered 535. A real
  `POST /api/auth/send-verification-email` for `mharith.dev@gmail.com` answered
  **200 `{"status":true}`**. That route awaits our sender directly and the
  sender rethrows, so a 200 there is Resend accepting the message rather than a
  request that merely did not crash.

  **`onboarding@resend.dev` delivers to one address, and that is the trap.** A
  probe send to a plus alias was refused: *550 You can only send testing emails
  to your own email address (mharith.dev@gmail.com).* Resend's shared domain
  answers every other recipient that way. So a registration at any address but
  that one is written, answered 200 with `token: null`, told to check an inbox —
  and the mail is refused at the provider. Five accounts in the development
  database are in exactly that state, three of them the owner's own attempts
  before the key was replaced.

  This is the fault the new log line was added for, met in the wild within
  minutes of it being written. The response a person sees is identical either
  way; the log is the only thing that separates them.

  A deployment that verifies addresses therefore needs a **verified sending
  domain**, not just a key. `SMTP_FROM` on the shared domain is a one-recipient
  instance.

  Still unproven: nobody has opened a link. The send is proven at the provider;
  arrival in an inbox and the redirect that follows a click are not.

- 2026-09-09T22:31+08:00 — **Proven end to end, live.** A link was sent,
  received in a real inbox and opened in a real browser.

  **The earlier 200 was misread, and the reason is worth keeping.**
  `POST /api/auth/send-verification-email` answers `{"status":true}` for an
  address that is already verified *and* for one that does not exist, having
  sent nothing — it signs a throwaway token and sleeps to a 500 ms floor, so
  response times cannot be used to enumerate addresses. The branch that decides
  this sits above `sendVerificationEmailFn`, and reading only the sender made
  the answer look like a successful send. **A route that awaits the sender is
  not a route that called it.**

  Timing is what separates the two, and it is a clean signal: the same route
  took **3.67 s** for a real send against **0.51 s** for an address it skipped.

  The send needed an unverified account at the one address Resend's shared
  domain will deliver to, so `mharith.dev@gmail.com` was set unverified for the
  test. The click restored it.

  What the click did, read out of the database: `email_verified` moved from
  false to true, and a session was written at 14:30:04 expiring on 16 September
  — seven days, which is `sessionMaxAgeSeconds`. So
  `autoSignInAfterVerification` works: the link confirms the address and signs
  the person in, with no second password prompt.

  Every acceptance box is now measured against a real provider and a real
  browser rather than against a capture.

- 2026-09-09T23:25+08:00 — **Proven from a verified sending domain, to somebody
  else's address.** `signalscout.run` was added at Resend and its DNS published
  — an MX and SPF pair on `send`, routing through `send.forge.rmta.net`, and a
  DKIM key at `resend._domainkey`. `SMTP_FROM` moved to
  `noreply@signalscout.run`.

  Two probes answered **250** where the shared domain had answered 550: one to
  the mail account's owner, one to an unrelated address. Then a real
  registration at `harith@journeys-inbox.space` took **3.53 s**, the link
  arrived, and opening it verified the account and wrote a session expiring
  seven days later.

  That is the first registration this product has completed at an address that
  is not the mail account owner's, which is what the cloud shape needs.

  **A domain is a separate thing from a key.** A valid key on
  `onboarding@resend.dev` answers *550 You can only send testing emails to your
  own email address* for every other recipient, so the instance is
  one-recipient and every other registration is written, answered 200, and
  never mailed. Five accounts reached that state before the domain was
  verified.

  **Registering an address that already exists looks exactly like success.**
  The owner met this and reported the product as broken. Better Auth fabricates
  a 200 with `token: null` and an invented user id — measured at **0.073 s**,
  no SMTP call, no row written — so that nobody can enumerate accounts. The
  screen said "check your email" and no mail was ever coming.

  The server's behaviour is right and stays. The screen was wrong to leave the
  person with no way out, so the panel now says that an address which already
  has an account is sent no link, and to sign in instead. It is a possibility
  rather than a statement, so it confirms nothing about any address, and
  `Login.test.tsx` asserts both halves.
