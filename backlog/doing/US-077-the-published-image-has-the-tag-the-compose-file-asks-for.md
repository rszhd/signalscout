---
id: US-077
title: The published image has the tag the compose file asks for
type: bug
priority: p1
created: 2026-09-08T20:15+08:00
parent: US-074
area: deployment
resolution:
---

## Context

`ghcr.io/rszhd/signalscout:latest` does not exist and never has.
`docker-compose.yml` defaults to it three times, and README.md tells a
self-hoster to clone, copy `.env.example` and run `docker compose up`. That
sequence cannot work: the pull fails on a tag nothing has published.

The cause is one word. The tag rule is
`type=raw,value=latest,enable={{is_default_branch}}`, and this repository's
default branch is `dev`, which CI does not run on at all. So the condition is
false on every run that could publish, and true only where nothing builds.

**The rule was correct when it was written and became wrong without being
edited.** `is_default_branch` reads a setting in a web interface, not anything
in this repository, so changing which branch is default silently changes what a
build publishes. `latest` should mean the released build, and this repository
says which branch that is: `main`. Naming it is both correct and stable.

**Nothing noticed because nothing self-hosts from the published image yet.**
Every deployment so far has been staging, which asks for `:staging` by name.
The first person to follow README.md would have found it.

## Acceptance

- [x] A push to `main` publishes `:latest`, and the condition names the branch
      rather than reading a repository setting
- [ ] `docker compose up` with no `SIGNALSCOUT_IMAGE` set pulls a real image
- [x] The check is a test rather than a reading: something fails when the
      compose file's default tag is one CI does not publish

## Notes

- `main` is 170 commits behind `dev` and has never been released. Publishing
  `:latest` therefore needs a push to `main`, which is a release decision and
  not part of this fix.
- `type=sha,format=long` is unaffected: it publishes on every push.

## Log

- 2026-09-08T20:15+08:00 — Found while automating the staging deploy, by asking
  the registry which tags exist rather than by anyone hitting it.
- 2026-09-08T20:18+08:00 — The condition names `main`. Two tests read both files
  together, because neither can be checked alone: one asserts the compose file's
  default tag is one CI publishes, the other that the macro is not used where a
  tag is enabled. Both were confirmed to go red — renaming a compose variable
  fails the first, restoring `is_default_branch` fails the second.

  The second assertion was wrong before it was right: it searched the whole
  workflow for the macro's name and failed on the comment explaining why the
  macro is not used. It now matches where the macro would be *used*.

  The middle box stays open. `main` is 170 commits behind `dev` and has never
  been released, so `:latest` will not exist until somebody pushes it — and
  that is a release decision rather than part of this fix.
