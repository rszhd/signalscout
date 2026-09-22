---
id: US-298
title: The docs have a site
type: chore
priority: p3
created: 2026-09-22T16:10+08:00
parent:
area: docs
resolution:
---

## Context

Thirteen documents under docs/ are the whole manual, and they are read
inside GitHub. That works for a contributor and reads badly on a phone. A
docs site is what Postiz and every other open-source product of this shape
ends up with, and it is where search engines send "how do I self-host X".

It is not worth doing before US-292 through US-295 have had a month to
work. A docs site for a repository nobody visits is a site nobody visits.
Parked until the README, the Releases and the no-clone install are in and
the repository shows people arriving.

## Acceptance

- [ ] A decision on where it lives: a path on signalscout.run served by the
      cloud repo's Astro site, or a separate static site from this repo.
      The Log records which and why.
- [ ] The markdown under docs/ stays the source. The site is generated
      from it; nothing is written twice.
- [ ] README.md's repository table links the site and the files both.

## Notes

- The cloud repo's `landing/` is already Astro on Vercel; Starlight would
  read this repo's docs/ from a submodule or a build-time fetch.

## Log

- 2026-09-22T16:10+08:00 — Written from a gap review against the Postiz playbook, and parked until the cheap work lands.
