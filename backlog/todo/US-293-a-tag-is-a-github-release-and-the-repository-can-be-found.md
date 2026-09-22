---
id: US-293
title: A tag is a GitHub Release, and the repository can be found
type: chore
priority: p1
created: 2026-09-22T16:00+08:00
parent:
area: tooling
resolution:
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

- [ ] `release.yml` creates a GitHub Release for the tag after the publish
      job succeeds, with the tag's CHANGELOG.md section as the body. A tag
      whose section is missing fails the step and says so.
- [ ] `release-ui.yml` does the same for `ui-v*` tags, from the UI package's
      changelog section.
- [ ] Every existing `v*` tag has a Release, backfilled from CHANGELOG.md.
- [ ] The repository has topics: at least `social-listening`,
      `lead-generation`, `intent-data`, `reddit`, `self-hosted`, `open-source`,
      `typescript`. The homepage URL is https://www.signalscout.run.
- [ ] The default branch decision is recorded here in the Log: either `main`
      becomes default, with the reason, or `dev` stays, with the reason.
- [ ] docs/releasing.md says that the Release is made by CI and what to do
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
