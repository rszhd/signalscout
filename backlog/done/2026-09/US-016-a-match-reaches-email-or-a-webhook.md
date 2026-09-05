---
id: US-016
title: A match reaches email or a webhook
type: feature
priority: p2
created: 2026-09-04T22:49+08:00
parent:
area:
resolution:
---

## Context

PLAN.md's flow ends in three places: the dashboard, email and a webhook. The
inbox alone means the product only works when someone remembers to open it,
and a monitor that runs every hour is worth little if it is read once a week.

Email must be plain SMTP. A self-hoster will not sign up for a mail service to
run a tool they self-host, and a hosted mail provider is just another SMTP
target, so one implementation serves both.

The failure to avoid is volume. A monitor that emails on every match trains
its user to ignore the emails within a week. So the default is a digest with a
score floor, not an alert per match. An immediate alert is available for high
scores, because a conversation twelve minutes old is worth interrupting
someone for and a day-old one is not.

The webhook is the extension point. It is what lets someone push matches into
Slack, Discord or their own system without us writing a connector for each.
PLAN.md lists Slack under notifications; a webhook makes it a user's ten-minute
job instead of our ticket.

## Acceptance

- [x] Email is sent over SMTP, configured by environment variables
- [x] A digest groups matches over a period, with a score floor, and is the
      default
- [x] An immediate alert can be enabled for matches above a threshold
- [x] No email is sent when a period produced no matches
- [x] A webhook posts a documented JSON payload per match or per digest
- [x] Webhook delivery retries with a backoff, and repeated failure disables
      the webhook and tells the user
- [x] A webhook payload is signed, so the receiver can verify it came from the
      instance
- [x] Notification settings are per monitor
- [x] With no SMTP configured, the app runs and the inbox works; email settings
      say what is missing

## Notes

- Uses Nodemailer over SMTP. Resend uses the documented SMTP connection;
  there is no Resend-specific SDK or account requirement for other providers.
- Settings start disabled. Email defaults to a 24-hour digest at score 50.
  Optional immediate email alerts also appear in the digest. Webhooks support
  a digest or a request per match. Settings changes start with future matches
  and cancel pending deliveries under the previous revision.
- Migration 0018 adds settings, deliveries and delivery items. The outbox
  commits before sending. The minute tick recovers a lost notify enqueue.
  Row locks serialize concurrent workers. Delivery ids survive retries, but a
  crash after acceptance and before commit can duplicate a send. Receivers
  must deduplicate the id; SMTP cannot promise exactly-once delivery.
- Four retry delays: 30, 60, 120 and 240 seconds, rounded to the next tick.
  Five consecutive webhook failures, or five failures of one delivery, disable
  the webhook. Failures are visible on monitor cards and notification settings.
- SMTP_PASSWORD and WEBHOOK_SIGNING_SECRET stay in the environment. No API
  response returns them. Provider errors are reduced to a safe local message.
  The payload, signature verification and Resend setup are in docs/notifications.md.
- Proven locally: real Postgres, pg-boss, jsdom controls and Nodemailer over a
  real TLS SMTP connection to an isolated receiver. Resend inbox delivery,
  a third-party webhook receiver and a real browser remain unproven.

- Depends on [US-011](US-011-the-inbox-shows-why-a-post-matched.md).
- STACK.md, *The stack*, for Nodemailer over SMTP.
- Slack and Discord are not connectors in this ticket. The webhook covers both
  and PLAN.md defers them.

## Log

- 2026-09-04T22:49+08:00 — Written from PLAN.md.

- 2026-09-05T19:23+08:00 — Implemented and verified. The full suite passed
  748 tests in 51 files in 80.20 seconds. Final focused verification passed
  47 tests in seven files after adding monitor failure notices and fixing
  an unavailable SMTP transport changing the webhook digest interval.
  Lint, typecheck and build passed. Migration 0018 applied to the local
  development database. A deliberate PUT-to-POST mutation made two screen
  tests fail; the original code was restored. No external email was sent.
