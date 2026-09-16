---
id: US-154
title: The engine and the pipeline are published to npm
type: chore
priority: p1
created: 2026-09-16T13:48+08:00
parent: US-151
area: architecture
resolution:
---

## Context

**A private repo can only depend on what is published.** After US-153 the
two shared packages exist, but both are `"private": true` at version
`0.0.0`, with `exports` that point at `src/` in development and `dist/` in
production. The cloud repo (US-155) needs a version it can pin, a `dist/`
it can import, and type declarations. This ticket makes CI produce them.

**A version, not a git URL.** A `github:` dependency rebuilds on every
install, needs the consumer to have the build tools, and hides which commit
is live. A published version is one number in the cloud repo's lockfile,
and a rollback is changing it back.

**One version for both packages, moved together.** The pipeline imports the
engine, and the two are tested together in one suite. Giving them separate
version numbers would say they can be mixed, and nothing has tested that.
Publish both with the same version on the same tag; the pipeline's
dependency on the engine is that exact version.

**Publishing is the release, so it happens on a tag and nowhere else.**
`pnpm publish` runs in the existing CI workflow when a `v*` tag lands on
`main`, after the check job passes, using an npm token in the repository's
secrets. It does not run on a push to `dev` or `staging`. A version that was
never tagged was never released.

**What a consumer gets must be tested from outside the workspace.** The
`development` export condition and the vitest alias mean nothing here has
ever imported the built `dist/`. A CI step packs both tarballs, installs
them into a scratch project outside the workspace, and imports one name
from each. That is the only check that the published shape works.

**The migrations ship with the pipeline.** `drizzle/` and the journal are
part of the package, and `migrate()` finds them relative to the package
root, not the working directory. A consumer that installs the pipeline can
apply its stream with no copy of this repository.

## Acceptance

- [ ] `@signalscout/engine` and `@signalscout/pipeline` are public on npm
      under the owner's scope, with the same version, `main`, `types`,
      `exports` and `files` set so `dist/`, `drizzle/` and the type
      declarations ship and `src/` and tests do not.
- [ ] The pipeline depends on the engine at an exact version, not
      `workspace:*` in the published manifest. `pnpm publish` rewrites it;
      the packed tarball is checked, not the source manifest.
- [ ] CI publishes both on a `v*` tag on `main`, after lint, typecheck,
      build and test pass, and on nothing else.
- [ ] A CI step packs both tarballs, installs them into an empty project
      outside the workspace, imports `createClassifier` from the engine and
      `migrate` from the pipeline, and runs the pipeline's migrations
      against the CI Postgres from that project.
- [ ] `docs/releasing.md` exists and says how to cut a version: the tag, the
      changelog line, what to check first. AGENTS.md's *Commands* names it.
- [ ] The first tag is `v0.1.0`, and the cloud repo in US-155 pins it.

## Notes

* `.github/workflows/ci.yml` — the `check` job to gate on, the `image` job
  as the model for a job that runs on a condition.
* `packages/*/package.json` — `"private": true`, `exports` with the
  `development` condition, the `0.0.0` version.
* `packages/core/src/db/migrate.ts` — check how it locates `drizzle/`.
* `Dockerfile` — the image build must keep working from the workspace, not
  from npm; the two are different consumers of the same packages.

## Log

- 2026-09-16T13:48+08:00 — Written as step three of US-151.
