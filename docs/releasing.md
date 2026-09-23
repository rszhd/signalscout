# Releasing the packages

`@signalscout/engine`, `@signalscout/pipeline` and `@signalscout/ui` are
published to npm so that a second application — the private cloud one,
US-155 — can install them by version. This is how a version is cut, and what
it means.

## Two series, because they move on different clocks

The engine and the pipeline share one number and one tag, `vX.Y.Z`. The UI
package has its own, `ui-vX.Y.Z`, and `.github/workflows/release-ui.yml`
publishes it alone (US-270).

Two series rather than one, for a reason in both directions. A colour must not
cost the pipeline a version nobody can explain. And a pipeline release must
not renumber the brand, because a consumer reading a new UI version expects
their screens to change and would go looking for what moved.

Everything below about what a number means, and about asking before taking a
release, is the same for both series.

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

The UI package is not in that tag. `ui-v1.2.3` runs the same checks, sets
that one package's version, proves the packed tarball installs and works
outside the workspace, and publishes it. It depends on neither of the other
two — `ui-boundary.test.ts` says so — so nothing has to move with it.

The manifests say `0.0.0` in git, on purpose. The tag is the version. A
number in a file is a number somebody forgets to move, and a pull request
that bumps it is a pull request about nothing.

## A release is asked for, not taken

**The owner approves every release.** Finish the work, commit it, say what is
waiting to go out, and wait for a yes. Three versions went out in one afternoon
on 2026-09-18 and that is the failure this rule exists to stop: every published
version is permanent, and a day of them is a changelog nobody can read.

**Several finished changes share one release.** There is no reason to cut a
version per ticket when the consumer takes them together, and a batched
changelog entry is the one a person can actually read.

Nothing about this slows the work down, because nothing waits on a release
anyway — the section below is how both halves are built and tested before any
version exists.

## While the work is in progress, nothing is cut

A feature usually has a half here and a half in the hosted application. That
one is built against this working copy, not against npm: it packs both
packages and installs the tarballs, with
`node scripts/packages-from-source.mjs on` in that repository. A version is cut
once, when both halves are finished.

Publishing to find out whether the other half reads a new table right — and
publishing again when it does not — leaves half-finished shapes on npm for
ever. Every version here is permanent and somebody else may be running it.

## What the number means

**The number is a promise about what the upgrade costs a consumer**, and
nothing else. It is not a measure of how much was written, how long it took, or
how pleased anybody is with it. There is one consumer today — the hosted
application — and every published version is permanent, so the promise has to
hold for whoever installs it next year.

Before 1.0 there are two answers. Ask one question and the answer falls out:

> **What must a consumer do to take this version?**

**Nothing → patch.** A fix. A number that becomes correct. A new optional field
beside an existing one. A faster query. Anything a consumer can install and
ignore.

**Something → minor.** A new export they call. A renamed or removed one. A
changed option or default. A return type that grew. **A migration**, always: a
release that adds one changes their database when it boots, and that is a thing
they must know about even when nothing in their code changes.

The major stays 0 until the shape of the packages stops moving. After 1.0 the
same question moves the major instead of the minor whenever the answer is
"change your code", and the minor takes the additions.

### What this project has done

| Version | Change | Why |
|---|---|---|
| 0.3.0 | `recordModelCall` requires `userId`, plus migration 0060 | Callers had to pass a new argument |
| 0.4.0 | `AI_TRIAGE=on\|off` and `triageIsOff` | A new export, and a stage a deployment can switch off |
| 0.5.0 | `stage_runs`, its reads, and `processNotifications` returning a summary | A new table and new exports |
| 0.6.0 | `stage_runs.walk_id`, carried through the job payloads | A migration, and a field a screen groups by |
| 0.6.1 | `detail.scored` counts what it scored; optional `detail.skipped` | A corrected number and a field that can be ignored |
| 0.7.0 | `stage_runs.poll_run_id` | A migration, and a field a screen joins on |
| 0.8.0 | `post_discoveries`, and `foundBy` on a connector's page | A new table and a field a connector must answer |
| 0.9.0 | `accountSpendSince` and `draftsSince`; relevance gates `leadScore` | Two new exports, and a score that moved |
| 0.10.0 | `typesafe` in `aiProviders`, `createEvaluationModel`, `evaluateChoice` | New exports, and an `AiProvider` union that grew |
| 0.11.0 | `readMatch`, `InboxFilters.matchId`; the CSV renames `intent` and adds five score columns | A new export, and a column heading a consumer may read by |

**0.10.0's only reaction is a type.** Everything in it is a new export beside
an existing one, and a deployment that sets nothing keeps the model it has. The
minor is for `AiProvider`, which gained `typesafe`: a consumer holding an
exhaustive `switch` over it stops compiling until they handle the new member.
Nothing else in that release asks anything of anybody.

**0.6.1 was first cut as 0.7.0**, on the strength of the added field alone. It
adds nothing a consumer must react to: the count simply becomes the number it
always claimed to be, and the new field beside it can be ignored for ever. A
fix stays a patch even when it adds something to explain itself.

### Where the number lives

In the tag, and nowhere else. Both manifests say `0.0.0` in git and the release
workflow writes the tag's number into both before it packs. A number in a file
is a number somebody forgets to move, and two packages with two numbers would
say they can be mixed.

## Cutting one

1. Merge to `main` the way any change reaches it: `dev`, then a pull request
   with a merge commit.
2. Decide the number with the question above: what must a consumer do?
3. Move what is under *Unreleased* in [CHANGELOG.md](../CHANGELOG.md) to a
   heading with the new number and the date, in the same pull request or the
   next one. It is short by design: what a consumer must know, not what the
   diff shows.
4. Tag the merge commit and push the tag:

       git tag v0.2.0 <sha on main>
       git push origin v0.2.0

5. Watch the *Release* workflow. It publishes nothing until the checks pass,
   and it says which step refused if one does.
6. A job re-tags the published image with `0.2.0` and `0.2`, from CI's
   cache. `latest` is not among them: that one follows `main`, and a tag can
   point at a commit `main` has moved past. A self-hoster pins a version with
   `SIGNALSCOUT_IMAGE` (site/self-hosting/install.md).
7. The last job makes the GitHub Release, titled with the tag and holding
   the tag's section of CHANGELOG.md. It runs after npm has the packages,
   so a refused publish leaves no Release naming a version nobody can
   install. It is what a watcher of this repository receives.

**When the Release job fails**, the cause is the changelog: the tag has no
`## 0.2.0 — date` heading, or the section under it is empty. Add the
section on `main`, then re-run the failed job from the workflow's page. Do
not move the tag. The packages are already on npm at that number, and a
tag that moves points a Release at a commit npm did not build.
`node scripts/release-notes.mjs v0.2.0` prints what the job will use, and
exits 1 for the same reasons it does.

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

None. Each package on npm lists `rszhd/signalscout` and its release workflow
as a trusted publisher — `release.yml` for the engine and the pipeline,
`release-ui.yml` for the UI package — so the release job authenticates with
the OIDC token GitHub mints for it, and no npm token exists anywhere. US-154
published the first version with a granular access token because a package
has to exist before npm will trust a workflow to publish it; US-156 replaced
the token. The UI package's trust was set only for 0.2.0, which is why the
workflow run for 0.1.0 failed with a 404 on publish.

A trusted publisher names one workflow file and cannot be changed afterwards;
renaming a release workflow means deleting the publisher on npm and adding
it again. Each one allows a direct `npm publish`; npm recommends staged
publishing instead, which would need the workflows to run `npm stage publish`
and the owner to approve each version on npmjs.com.

## Versions

[CHANGELOG.md](../CHANGELOG.md) holds every published version and what a
consumer must know about it. It lives at the root rather than here because it
is written for somebody installing the packages, who has not read this file and
should not have to.
