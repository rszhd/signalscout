---
id: US-093
title: A match reaches a person without being asked to
type: feature
priority: p1
created: 2026-09-09T23:58+08:00
parent:
area:
resolution: done
---

## Context

**Nothing this product has ever found has reached anybody by email.** US-016
built digests, immediate alerts and signed webhooks on 2026-09-05, and on
2026-09-09 the development database held **zero rows in
`notification_settings` and zero in `notification_deliveries`**. The feature
works and nobody has switched it on.

That is the default's fault rather than the person's. A monitor is created,
polls, classifies and fills an inbox, and the one screen that would tell
somebody about it starts disabled behind a second visit they have no reason to
make. The owner decided on 2026-09-09 that a match should reach a person
without being asked to, on the self-hosted instance and on the cloud alike.

**The mailer is proven and it is the same mailer.**
`verificationSenderFor` in `server.ts` calls
`createNotificationTransport(env).email` — US-092's transport is US-016's
transport, one mail server per deployment. That path delivered a real link to a
real inbox at an address that is not the mail account owner's, in 3.53 seconds,
through Resend on the verified domain `signalscout.run`. So there is no
transport question left to answer here. What is missing is a row.

**Email is defaulted on and the webhook is not, and that is not an
inconsistency.** A webhook needs a URL only the person has. There is nothing to
guess, so it stays where it is. Email now has a recipient that did not exist
when US-016 was written: US-017 gave the instance accounts, so the monitor's
owner has an address.

**Where it can send, and nowhere else.** This is
`AUTH_EMAIL_VERIFICATION`'s rule and reason again, and US-092 wrote it down:
the requirement and the transport are one thing, and the state this must never
be in — notifications on, no way to send — should be impossible to describe
rather than merely avoided. So the default is derived from
`notificationReadiness`, not from a new variable. A cloud account gets email;
a self-hosted instance with SMTP gets email; a self-hosted instance without SMTP
gets a row with email off, and its notification screen already names
`SMTP_HOST` and `SMTP_FROM`.

Defaulting it on everywhere would queue deliveries on an instance with no
mailer, fail them five times each, and report an error on a monitor card its
owner never asked to be notified by. That is the failure this shape prevents.

**The immediate threshold is 70, and the shipped 90 is why it needs moving.**
Measured best scores: Reddit 71, X 66, LinkedIn 69, TikTok 82, Instagram 90. At
90 an immediate email would have fired twice in this product's whole history. At
70 it fires for the leads a person would want to answer the same hour, and the
24-hour digest at 50 carries the rest — where US-022 measured that 50 leaves
nine matches that are all real and 30 lets "Dev memes" through.

**Only new monitors.** The owner decided against a migration. An existing
monitor stays silent until somebody opens its notification screen and saves,
which is the screen that already exists and already works.

## Acceptance

- [x] Creating a monitor writes a `notification_settings` row. The rule is one
      function in `packages/core`, not a route
- [x] Email is enabled when the deployment can send and the owner has an
      address, and disabled when it cannot — no new environment variable, and
      `notificationReadiness` is the one thing asked
- [x] The recipient is the monitor owner's account address
- [x] The defaults are a 24-hour digest at `min_score` 50 and an immediate
      email above 70
- [x] The webhook is left off, with no URL invented
- [x] A monitor created on an instance with no SMTP gets a row with email off,
      queues nothing, and its notification screen says what is missing — the
      existing sentence, unchanged
- [x] Editing the settings afterwards behaves exactly as it does today: the
      save starts a new period, and no backlog is delivered
- [x] Existing monitors are untouched. No migration, and a monitor with no row
      still sends nothing
- [x] A live send: one real match reaches one real inbox, and the delivery row
      says `sent` — three rows say it. Inbox placement is the owner's to
      confirm; SMTP acceptance is what this side can see

## Notes

- `notificationInputSchema` already holds the shape and the refinements. The
  new function returns a `NotificationInput` and `saveNotificationSettings`
  writes it, so `next_digest_at` and `enabled_since` are computed in the one
  place that already computes them.
- The two facts the rule needs — can this deployment send, and what is the
  owner's address — belong to the composition root. `sessionUser` on the
  request already carries the address; `notificationReadiness(env)` already
  answers the other.
- Do not send a backlog. `enabled_since` is set to the moment the row is
  written, so only matches found afterwards are eligible. That is the existing
  rule and it is what makes defaulting this on safe.
- docs/notifications.md opens with "Email and webhooks start disabled". That
  sentence needs correcting in the same commit, or the document contradicts the
  product on its first line.

## Log

- 2026-09-09T23:58+08:00 — Written after a check of the running database found
  zero notification settings rows and zero deliveries, on an instance that has
  collected 174 posts and 20 matches. The owner chose the digest-plus-immediate
  default and chose not to migrate existing monitors.
- 2026-09-10T00:02+08:00 — Built. `defaultNotificationSettings` is the rule and
  `createMonitor` writes the row through `saveNotificationSettings`, so
  `enabled_since` and `next_digest_at` are computed where they always were. The
  two inputs — can this deployment send, and the owner's address — are asked at
  the composition root: `notificationReadiness(env)` in `server.ts`, and
  `sessionUser(request).email` in the create handler.
- 2026-09-10T00:02+08:00 — 1,696 tests pass, nine of them new. Two deliberate
  mutations were confirmed to turn the suite red: dropping the `canSendEmail`
  half of the rule, and not writing the row at all.
- 2026-09-10T00:02+08:00 — Unproven: no email has been sent for a real match.
  The transport is proven — US-092 delivered through the same
  `createNotificationTransport(env).email` to a real inbox in 3.53 s — but
  nothing has carried a match through it.
- 2026-09-10T00:16+08:00 — Delivered live. `live:notification` created a
  monitor through `createMonitor`, read **40 stored r/softwaretesting posts**
  and called no provider at all, and the settings row came out as designed:
  email on to the account's own address, digest every 24 h at 50+, immediate
  above 70, webhook off.
  Six matches — **90, 75, 63, 62, 52, 51** — and three deliveries, every one
  `sent` on the first attempt with no error recorded: an immediate email for
  the 90, an immediate for the 75, and a digest carrying all six. The 90 was
  due the moment it was written and needed no clock at all.
  Cost: **$0.166 of model, $0.00 of provider**, over three runs. 66 triage
  calls and 38 classifications.
- 2026-09-10T00:16+08:00 — Two findings came with it. The first two samples,
  20 newest Reddit posts and 20 newest from the subreddit, produced **zero
  matches at 50** on `gpt-5.6-terra`; the oldest forty produced six. A sample
  aimed at nothing measures nothing. And one of 26 answers came back as
  malformed JSON — Malayalam and Chinese characters spliced into a reason —
  recorded as `rejected` with the post keeping its place. That is the **third**
  live sighting of US-006's failure path.
