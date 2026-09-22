---
id: US-322
title: A match reaches Slack, Discord or Telegram
type: feature
priority: p2
created: 2026-09-23T05:44+08:00
parent:
area: notifications
resolution:
---

## Context

A match leaves the instance by email or by a signed webhook.
docs/notifications.md says that Slack and Discord need a receiver that
translates the webhook, so a person who lives in chat must build and host one.
A native destination per chat service is also the kind of work an outside
contributor can finish alone: one destination, one pull request, and no change
to the rule against a seventh social network.

Parked until US-321 says whether this belongs in the open build.

## Acceptance

- [ ] A monitor can deliver to a Slack or Discord incoming-webhook URL, in the
      service's own message format.
- [ ] Delivery goes through the existing outbox, with its retries and its
      delivery id.
- [ ] A URL is checked by `address-guard.ts` like the webhook's.
- [ ] Each destination was delivered to once for real, and the Log says which.
- [ ] Telegram, or any further service, is its own ticket labelled
      `help wanted`.

## Notes

- `packages/pipeline/src/notifications/`: `deliver.ts`, `transport.ts`,
  `live-webhook.ts`.
- The code lives in `packages/pipeline`, which the hosted application also
  takes. Flag that in the pull request.

## Log

- 2026-09-23T05:44+08:00 — Written from a review of the repository as an AI-assisted open-source
  project, and parked behind US-321.
