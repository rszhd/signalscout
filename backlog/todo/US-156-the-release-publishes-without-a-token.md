---
id: US-156
title: The release publishes without a token
type: chore
priority: p2
created: 2026-09-16T18:02+08:00
parent: US-151
area: architecture
resolution:
---

## Context

**The first publish used a token that npm is retiring.** US-154 published
`v0.1.0` with a granular access token — `signalscout-release`, read and
write on the `@signalscout` scope, bypass 2FA — because a package has to
exist before npm will let a workflow be trusted to publish it. npm said two
things on the page where it was made: the token expires on 2026-12-15, and
tokens that bypass 2FA lose the right to publish directly in January 2027.
So the token is a bridge, and this ticket takes it down.

**Trusted publishing is the replacement.** npm accepts a GitHub Actions
OIDC token from a named repository and workflow file in place of a secret.
`release.yml` already carries `id-token: write` and `--provenance`, which
is everything the workflow side needs. What remains is on npm: each
package's settings page gets a trusted publisher — repository
`rszhd/signalscout`, workflow `release.yml` — and then the token can go.

**Both packages, then the secret.** Configure the engine and the pipeline
before deleting `NPM_TOKEN`, and prove one release with the token gone,
because the failure mode is a release job that passes every check and then
cannot publish.

## Acceptance

- [ ] `@signalscout/engine` and `@signalscout/pipeline` each list
      `rszhd/signalscout` / `release.yml` as a trusted publisher on npm.
- [ ] `release.yml` sets no `NODE_AUTH_TOKEN`; the `NPM_TOKEN` secret is
      deleted from the repository; the token is revoked on npm.
- [ ] One tag after that publishes both packages, with provenance shown on
      each package page.
- [ ] `docs/releasing.md`, *Secrets*, says there is none.

## Notes

* npm: package page → Settings → Publishing access / Trusted publisher.
* The token's expiry, 2026-12-15, is the deadline that matters.

## Log

- 2026-09-16T18:02+08:00 — Written after the first publish, from what
  npm's token page said.
