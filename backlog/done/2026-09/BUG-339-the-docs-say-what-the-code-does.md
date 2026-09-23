---
id: BUG-339
title: The docs say what the code does
type: bug
priority: p2
created: 2026-09-23T10:00+08:00
parent:
area: docs
resolution: shipped
---

## Context

A pass over every document, on the owner's request, compared each claim with
the code. A script checked every link, path, `pnpm` script, variable and
backticked code name, and all of them resolved. The drift was in facts that no
name check can see: a state renamed, a file moved, a provider list that
missed a pair, a lint rule that widened.

One finding was more than wording. `docs/secrets.md` told every self-hoster
to rotate the key with `pnpm db:rotate-key`, which runs `tsx` on the source.
The published image has neither, and since US-295 the README tells a
self-hoster they need no git and no Node. The compiled script is in the image
already, so the fix is the command, not the image.

## Acceptance

- [x] `docs/notifications.md` names the palette's file in `packages/ui`.
- [x] `docs/map.md` names `triage.ts` for the triage stage, not the key probe.
- [x] The engine README names the `ready` state and the `describe` job.
- [x] The UI README says `lint:css` reads every page stylesheet, as
      `package.json` does since US-270.
- [x] The README lists ScrapeCreators for YouTube and TikTok, and its table
      names `docs/pipeline.md`, `docs/releasing.md` and `packages/ui`.
- [x] `docs/self-hosting.md` names ScrapeCreators' platforms, marks Bright
      Data switched off, and counts five model jobs.
- [x] `docs/secrets.md` gives a rotation command that runs in the published
      image, and it was run there.
- [x] The `measure-scoring-change` skill no longer names the retired history
      paragraph.

## Notes

The image command, run against a scratch database with one credential sealed
under a fresh key:

    docker run --rm --network host -e DATABASE_URL -e ENCRYPTION_KEY \
      -e NEW_ENCRYPTION_KEY ghcr.io/rszhd/signalscout:latest \
      node packages/pipeline/dist/secrets/rotate-cli.js

The documented form is `docker compose run` on the `app` service, which
carries the same variables. That form itself was not run.

US-050 is in `todo/`, but `packages/engine/src/ai/describe.ts` ships and the
engine exports it. The ticket was not moved here; which part is left is the
owner's call.

## Log

- 2026-09-23T10:00+08:00 — Checked every document against the code and fixed
  the eight that drifted. Ran the rotation script inside
  `ghcr.io/rszhd/signalscout:latest`: one credential re-encrypted, and the new
  key read it back.
- 2026-09-23T10:40+08:00 — Found three more. The boot check decrypts provider
  keys only, so `docs/secrets.md` no longer says it verifies a rotation;
  BUG-341 is the code. The recovery SQL in `docs/accounts.md` moved the
  webhook secret, which does not open under a new id, missed `stage_runs`, and
  pointed its check at the schema file that is now a folder.
