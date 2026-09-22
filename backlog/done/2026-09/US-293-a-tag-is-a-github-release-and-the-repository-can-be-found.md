---
id: US-293
title: A tag is a GitHub Release, and the repository can be found
type: chore
priority: p1
created: 2026-09-22T16:00+08:00
parent:
area: tooling
resolution: shipped
---

## Context

Eighteen tags, zero Releases. Somebody who clicks *Watch → Releases* has
never heard from us, and the Releases page — the one GitHub links from the
sidebar of every repository — is empty. CHANGELOG.md has the words already;
they are not where a watcher looks.

The repository has no topics and no homepage URL, so GitHub's topic pages
and search cannot surface it. And the default branch is `dev`: a visitor
lands on unreleased code, and the README they read may describe a version
the image does not ship yet.

None of this is work. It is settings and one CI step, and it is the cheapest
visibility the project can buy.

## Acceptance

- [x] `release.yml` creates a GitHub Release for the tag after the publish
      job succeeds, with the tag's CHANGELOG.md section as the body. A tag
      whose section is missing fails the step and says so.
- [x] `release-ui.yml` does the same for `ui-v*` tags, from the UI package's
      changelog section.
- [x] Every existing `v*` tag has a Release, backfilled from CHANGELOG.md.
- [x] The repository has topics: at least `social-listening`,
      `lead-generation`, `intent-data`, `reddit`, `self-hosted`, `open-source`,
      `typescript`. The homepage URL is https://www.signalscout.run.
- [x] The default branch decision is recorded here in the Log: `main` is
      the default since 2026-09-22.
- [x] docs/releasing.md says that the Release is made by CI and what to do
      when the step fails.

## Notes

- `gh release create v0.13.1 --notes-file <(sed -n '/^## 0.13.1/,/^## /p' CHANGELOG.md)`
  is the shape of the backfill; `softprops/action-gh-release` or `gh` in
  the workflow is the shape of the step.
- Topics and homepage are `gh repo edit --add-topic ... --homepage ...`.
  They are owner actions on the GitHub side, not commits.
- The default branch matters to CI too: `ci.yml`'s `:latest` tag is keyed on
  `refs/heads/main` by name, precisely because the default is `dev`.

## Log

- 2026-09-22T16:00+08:00 — Written from a gap review against the Postiz playbook.
- 2026-09-22T17:05+08:00 — Shipped. `scripts/release-notes.mjs` prints a tag's CHANGELOG.md section and exits 1 without one; it was run on all 18 tags and found every section. Both release workflows end in a job that makes the Release from it, after npm has the packages. Backfilled 18 Releases with `gh release create`, oldest first. Topics and homepage set. The Release job itself runs for the first time on the next tag.
- 2026-09-22T17:05+08:00 — Default branch: `main`, on the owner's decision. A visitor now sees the released code and the README the image matches. The cost is that a fork's pull request targets `main` unless the contributor changes it; CONTRIBUTING.md and the PR template say to. CI keeps `main` by name for `:latest`, so the setting cannot undo the publish.
