---
id: US-382
issue: 113
title: A release waits for the owner on npm
type: chore
priority: p2
created: 2026-09-23T21:18+08:00
parent:
area: release
resolution:
---

## Context

Both release workflows publish straight to npm through a trusted publisher
(US-156). No npm token exists, but the publish job can still mint a
short-lived publish credential from GitHub, and any code that runs in that
job — a compromised dependency during `pnpm install` or the build — could use
it. The npm worms of 2025 spread by publishing from exactly such places.

npm's staged publishing closes that gap. A workflow stages the version, and
it goes live only when a maintainer approves it with 2FA. The owner already
approves every release (`docs/releasing.md`), so the approval costs a minute
and adds no new decision. The hosted application installs these packages in
production, so a bad version would reach paying accounts.

Two facts shape the change. `npm stage publish` is unaware of workspaces:
it packs the current folder and would not rewrite the pipeline's
`workspace:*` dependency on the engine, which `pnpm` does. And npm's page
lists `--provenance` for it but does not say whether it takes a tarball, so
`pnpm pack` then `npm stage publish <tarball>` is unproven until a real
release runs it.

## Acceptance

- [ ] `release.yml` and `release-ui.yml` build each tarball with `pnpm pack`
      and stage it with `npm stage publish --provenance`, the engine before
      the pipeline.
- [ ] A dry run proves `npm stage publish` takes a `pnpm pack` tarball with
      the engine version rewritten, before the first real release.
- [ ] The GitHub Release says the version waits for approval, or waits for
      it, so the Releases page never names a version npm does not serve.
- [ ] `docs/releasing.md` and the `cut-release` skill name the approval step:
      `npm stage list`, then `npm stage approve <id>` for each package, then
      the pin in the hosted application.
- [ ] On npm, each package's trusted publisher allows `npm stage publish`
      only. The owner changes this, with 2FA, once the workflows stage.
- [ ] The first staged release is approved and installs from npm, and the
      Log says so.

## Notes

Not covered: the image. `ghcr.io/rszhd/signalscout` is still pushed by CI
directly, and self-hosters install that, not the packages.

The trusted publisher's workflow name cannot be changed after it is created,
so the workflows keep their file names.

## Log

- 2026-09-23T21:18+08:00 — Written on the owner's decision after the 0.15.0
  and ui 0.2.0 releases. The same day the owner set each package's
  publishing access to "Require two-factor authentication and disallow
  bypass 2fa tokens", which needs no workflow change: npm says a trusted
  publisher works under every option.
