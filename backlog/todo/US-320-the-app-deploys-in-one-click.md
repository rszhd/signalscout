---
id: US-320
title: The app deploys in one click
type: feature
priority: p2
created: 2026-09-23T05:44+08:00
parent:
area: self-hosting
resolution:
---

## Context

The install is five lines and a compose file, which is short for a person at a
terminal. Many self-hosters never open one: they deploy from a template on
Coolify, Dokploy or Railway. Postiz, the model for this project's growth, is
listed on those platforms, and the listing is also a place people find it.

## Acceptance

- [ ] A template exists for at least two of Coolify, Dokploy and Railway,
      and it generates `AUTH_SECRET` and `ENCRYPTION_KEY` itself.
- [ ] Each template was deployed once from scratch, and the Log says which
      platform, how long it took and what the first screen showed.
- [ ] The README names each template with its button or link.
- [ ] Each template pins a version tag, not `latest`.

## Notes

- `docker-compose.yml` and `.env.example.self-hosted` are the source; a
  template should not grow a setting they do not have.
- Coolify and Dokploy take templates through pull requests to their own
  repositories.

## Log

- 2026-09-23T05:44+08:00 — Written from a review of the repository as an AI-assisted open-source
  project.
