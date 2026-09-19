---
name: cut-release
description: Cut a version of @signalscout/engine and @signalscout/pipeline. Use only when the owner has said yes to a release; several finished changes share one.
---

# Cut a release

`docs/releasing.md` holds the reasoning. The owner approves every release.

1. Ask: what must a consumer do to take this version? Nothing → patch.
   Anything, including a migration → minor.
2. Check locally what CI will check: `pnpm build && pnpm release:verify`
   against the Postgres `pnpm db:up` starts.
3. Move *Unreleased* in `CHANGELOG.md` under the new number and today's
   date. Short: what a consumer must know, not what the diff shows.
4. Merge to `main` the usual way: `dev`, then a pull request with a merge
   commit.
5. Tag the merge commit and push the tag:
   `git tag vX.Y.Z <sha on main> && git push origin vX.Y.Z`.
6. Watch the *Release* workflow. It publishes nothing until every check
   passes.
7. In the cloud repository: `node scripts/packages-from-source.mjs off`,
   move both pins in `apps/api/package.json` and the root
   `devDependencies` to the new version, run the suite, and say in the
   commit which version and why.

Both manifests say `0.0.0` in git. The tag is the version; do not edit a
number in a file.
