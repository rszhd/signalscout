# Releasing the packages

`@signalscout/engine` and `@signalscout/pipeline` are published to npm so
that a second application — the private cloud one, US-155 — can install them
by version. This is how a version is cut, and what it means.

## One version, both packages, one tag

A release is a git tag `vX.Y.Z` on a commit that `main` has. Pushing the tag
is the whole act: `.github/workflows/release.yml` refuses a tag that is not
on `main`, runs every check `main` runs, builds the image, sets both
packages' versions from the tag, packs them, installs the tarballs into an
empty project and uses them from there, and only then publishes.

Both packages carry the same version and move together. The pipeline
depends on the engine at that exact version, because the two are tested
together in one suite and nothing has tested them mixed. There is no
separate engine release.

The manifests say `0.0.0` in git, on purpose. The tag is the version. A
number in a file is a number somebody forgets to move, and a pull request
that bumps it is a pull request about nothing.

## Cutting one

1. Merge to `main` the way any change reaches it: `dev`, then a pull request
   with a merge commit.
2. Decide the number. Before 1.0, a change that a consumer must react to —
   a renamed export, a changed option, a table that moved streams — moves
   the minor; anything else moves the patch.
3. Add a line to the *Versions* table below, in the same pull request or the
   next one. It is the changelog, and it is short by design: what a
   consumer must know, not what the diff shows.
4. Tag the merge commit and push the tag:

       git tag v0.2.0 <sha on main>
       git push origin v0.2.0

5. Watch the *Release* workflow. It publishes nothing until the checks pass,
   and it says which step refused if one does.

Check first, locally, what CI will check: `pnpm build && pnpm release:verify`
against the Postgres `pnpm db:up` starts. It packs, installs into
`$TMPDIR`, imports, migrates, and cleans up. It spends nothing.

## What a consumer gets

- `dist/` and the type declarations, without the tests. Not `src/`.
- The pipeline's `drizzle/` folder, so `runMigrations` applies the
  pipeline's stream from inside `node_modules`.
- `exports` without the `development` condition the workspace uses.
- `@signalscout/pipeline/testing` and `@signalscout/engine/testing`, so a
  consumer's tests can create a database per file the way this repository's
  do.

## Secrets

None. Each package on npm lists `rszhd/signalscout` and `release.yml` as a
trusted publisher, so the release job authenticates with the OIDC token
GitHub mints for it, and no npm token exists anywhere. US-154 published the
first version with a granular access token because a package has to exist
before npm will trust a workflow to publish it; US-156 replaced the token.

## Versions

| Version | Date | What a consumer must know |
|---|---|---|
| 0.1.0 | 2026-09-16 | First publish. Engine and pipeline as US-152 and US-153 left them. |
| 0.1.1 | 2026-09-16 | `@signalscout/pipeline/testing` exports `insertMonitor` and `fastRetries`. Nothing else changes. |
| 0.1.2 | 2026-09-16 | Published through trusted publishing, without a token. No code change. |
