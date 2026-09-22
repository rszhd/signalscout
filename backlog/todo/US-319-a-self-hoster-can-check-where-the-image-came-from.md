---
id: US-319
issue: 73
title: A self-hoster can check where the image came from
type: chore
priority: p2
created: 2026-09-23T05:44+08:00
parent:
area: release
resolution:
---

## Context

The npm packages are published with `--provenance`. The Docker image, which is
what most self-hosters run, carries no signature and no attestation, so nobody
can prove that `ghcr.io/rszhd/signalscout` was built by this repository's CI
from a given commit. The workflows also name every action by a tag
(`actions/checkout@v5`), and a tag can be moved.

## Acceptance

- [ ] The `image` job in `ci.yml` and the version job in `release.yml`
      attach a build provenance attestation to the pushed digest.
- [ ] `docs/self-hosting.md` shows the one command that verifies it
      (`gh attestation verify`), and the Log shows it run on a real tag.
- [ ] Every `uses:` in `.github/workflows/` names a commit SHA, with the
      tag in a comment.

## Notes

- `actions/attest-build-provenance` needs `id-token: write` and
  `attestations: write`.
- US-318's bot keeps SHA pins current; without it, pins go stale.

## Log

- 2026-09-23T05:44+08:00 — Written from a review of the repository as an AI-assisted open-source
  project.
