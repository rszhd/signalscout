---
id: US-360
issue: 103
title: A pull request builds the image beside the checks
type: chore
priority: p3
created: 2026-09-23T14:32+08:00
parent:
area: ci
resolution:
---

## Context

In `.github/workflows/ci.yml` the `image` job has `needs: check`. On a pull
request the image is not published. The build only proves that the
Dockerfile still works, so it has no reason to wait. On 2026-09-23 the checks
took about three minutes and the image build 206 seconds, one after the
other.

A push to `main` and a release call publish the image, so there the order
must stay.

## Acceptance

- [ ] On a pull request, the image build starts without waiting for `check`
- [ ] On a push to `main` and on `workflow_call`, the image still waits for
      `check`, and the `digest` output is unchanged
- [ ] The Log records the time of one pull request run before and after

## Notes

GitHub Actions cannot make `needs` conditional. One way is two jobs: one for
pull requests with no `needs`, and the current one limited to the other
events.

## Log

- 2026-09-23T14:32+08:00 — Written from a review of the development loop.
