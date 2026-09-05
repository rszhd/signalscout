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

- [ ] Email is sent over SMTP, configured by environment variables
- [ ] A digest groups matches over a period, with a score floor, and is the
      default
- [ ] An immediate alert can be enabled for matches above a threshold
- [ ] No email is sent when a period produced no matches
- [ ] A webhook posts a documented JSON payload per match or per digest
- [ ] Webhook delivery retries with a backoff, and repeated failure disables
      the webhook and tells the user
- [ ] A webhook payload is signed, so the receiver can verify it came from the
      instance
- [ ] Notification settings are per monitor
- [ ] With no SMTP configured, the app runs and the inbox works; email settings
      say what is missing

## Notes

- Depends on [US-011](US-011-the-inbox-shows-why-a-post-matched.md).
- STACK.md, *The stack*, for Nodemailer over SMTP.
- Slack and Discord are not connectors in this ticket. The webhook covers both
  and PLAN.md defers them.

## Log

- 2026-09-04T22:49+08:00 — Written from PLAN.md.
