---
id: BUG-033
title: The image does not know the UI package
type: bug
priority: p1
created: 2026-09-20T20:45+08:00
parent: US-270
area: ops
resolution: shipped
---

## Context

The Dockerfile's dependency stage copies each workspace manifest by name so
that a source change does not reinstall. US-270 added `packages/ui` and did
not add its manifest to the list. `pnpm install --frozen-lockfile` then
installs no peers for a package it cannot see, and `pnpm build` fails inside
the image with "Cannot find module 'react'" from every file in the package.
The first pull request after the split, #26, found it: the test job passed
and the image job failed.

## Acceptance

- [x] Both stages that copy manifests copy `packages/ui/package.json`.
- [x] `docker build .` completes and the web bundle is in the image.
- [x] The image job on #26 passes.

## Notes

- The runtime stage does not need the package's output: the web bundle is
  static, and the API does not import it. It needs the manifest only so that
  the frozen lockfile resolves.

## Log

- 2026-09-20T20:45+08:00 — Found by the image job on #26. Added the manifest
  to the dependency and runtime stages. The build stage and the whole image
  build locally, and `apps/web/dist/index.html` is present in the image.
