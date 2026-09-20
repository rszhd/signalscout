---
id: US-270
title: One brand in a UI package both applications wear
type: feature
priority: p2
created: 2026-09-20T11:05+08:00
parent:
area: web
resolution:
---

## Context

The two applications share a brand and hold two copies of it. `apps/web/src`
here and in the hosted repository each carry `tokens.css`, `theme.css`,
`Button`, `Dialog`, `Field`, `BrandIcon`, `BrandLogo`, `labels.ts` and the
rules in `monitor.tsx`. Measured on 2026-09-20: `Button`, `BrandIcon` and
`api.ts` are identical by accident; the token names agree on 48 and differ
on 8; the token values differ almost everywhere, because the hosted
application redrew its theme (US-180, US-184, US-228 there) and this one
did not follow; and the words in `monitor.tsx` — `pollSummary`,
`stageLabel`, `monitoringState`, `band` — were rewritten twice, the second
time by hand (US-265 here).

The owner's decision: **the brand is one and the screens are two.** The
palette, the type and spacing scales, the controls, the mark and the words
about the data live in one package. Each application keeps its screens,
its page stylesheets, its routes and its layouts, which are free to differ —
one monitor per project on the cloud, five steps and a budget here.

**The hosted theme becomes the package.** It is the newer, deliberate one
and it is what the marketing site shows. This application moves onto it,
and its screens change look in this step; that is the point rather than a
side effect.

The shape is the one the repository already has: a package published from
here, versioned on its own number, pinned by the cloud. US-151 says the
packages are what the two share, and this is one more.

Decisions the ticket makes rather than the code:

- **A shared control uses a token name and never a raw value.** That is the
  rule that lets both applications wear one theme. No application holds a
  `tokens.css` of its own; an application that needs a new token asks the
  package for it.
- **The words take options where the applications differ.** The cloud's
  `pollSummary` carries no spend (US-173 there) and its `monitoringState`
  knows `pausedByPlan`. The shared functions accept both, so neither
  application loses a sentence.
- **Its own version.** A colour change must not be a pipeline release. The
  `cut-release` skill gains a third package with its own number.
- **The design document splits.** The package owns the part of
  `docs/design.md` about tokens, the spacing scale (US-261) and the controls;
  each application keeps the part about its layouts.

## Acceptance

- [ ] `packages/ui` exists, published as `@signalscout/ui`, with `tokens.css`
      (the hosted theme's values), `theme.css`, `Button`, `Dialog`, `Field`,
      `BrandIcon`, `BrandLogo` and the mark, `requestJson`, and the words:
      `platformName`, `providerName`, `ageLabel`, `untilLabel`,
      `formatMicros`, `stopReasonLabel`, `pollSummary`, `stageLabel`,
      `stageOf`, `monitoringState`, `stageDidLabel`, `stageLine`, `band`.
- [ ] A boundary test says the package imports no `pg`, `drizzle-orm`,
      `@signalscout/pipeline` or `@signalscout/engine`, and reads no
      `process.env`. React is a peer dependency.
- [ ] `apps/web` here imports every one of those from the package, and its
      own copies are deleted, including `styles/tokens.css`.
- [ ] `stylelint` refuses a raw colour or a raw spacing value in
      `packages/ui` and in `apps/web/src/styles`.
- [ ] `pollSummary` takes `{ subject, spend }` and `monitoringState` reads an
      optional `pausedByPlan`; the unit tests for the words move to the
      package and pass there.
- [ ] `docs/design.md` here keeps only the layouts; the tokens, the spacing
      scale and the control rules live in `packages/ui/README.md`.
- [ ] The `cut-release` skill and `docs/releasing.md` name the third package
      and its own version; `0.1.0` is published.
- [ ] AGENTS.md's theme paragraph says the colours and sizing live in
      `@signalscout/ui`, and a screen never writes a raw value.
- [ ] Every screen was rendered once in a browser after the move, and the
      Log says what was seen.

## Notes

- Hosted repository: `apps/web/src/styles/tokens.css`, `styles/theme.css`,
  `BrandLogo.tsx`, `public/brand/mark.svg`, `docs/design.md` (*Brand mark*),
  `monitor.tsx` (`pollSummary` with `PollSubject`, `monitoringState` with
  `pausedByPlan`).
- Here: `apps/web/src/monitor.tsx`, `labels.ts`, `Inbox.tsx` (`band`),
  `components/`, `docs/design.md`.
- `packages/engine/package.json` — the shape of a published package here:
  `exports` with a `development` condition on `src`, `files` on `dist`.
  The UI package adds CSS to `files` and a `./tokens.css` export.
- `.claude/skills/cut-release/SKILL.md`, `docs/releasing.md`.
- Both applications build with Vite, which resolves a package's CSS import.
- US-271 in the hosted repository is the second half: pin, delete the
  copies, keep the screens.

## Log

- 2026-09-20T11:05+08:00 — Written after the owner's decision that the two
  applications share one brand and two sets of screens.
