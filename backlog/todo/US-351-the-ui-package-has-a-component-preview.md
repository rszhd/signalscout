---
id: US-351
title: The UI package has a component preview
type: chore
priority: p2
created: 2026-09-23T13:51+08:00
parent: US-270
area: web
resolution:
---

## Context

The owner wants most of the two applications' screens built from components
in `packages/ui`, the hosted application's copy taken as the canonical one
(US-352 to US-355). A component in a package has no route: today the only way
to see one is to run the whole application, sign in, make a project and wait
for a match. A preview renders each component on its own, in each state a
screen can put it in, with fixture data and no server.

**Storybook, chosen on 2026-09-23.** The owner asked for Storybook or
something better. The comparison, read from npm that day:

| Tool | State | Why not, or why |
| --- | --- | --- |
| Storybook 10.6, `@storybook/react-vite` | Released 2026-09-19 | Supports Vite 8 and React 19. The tool a newcomer already knows (US-313, US-314). Stories are CSF, which other tools read too. |
| React Cosmos 7.4 | Active | Lighter; fewer contributors know it. |
| Ladle 5.1 | No release since 2025-11 | Bundles its own Vite. |
| Histoire | No React plugin | — |

**The stories are not tests yet.** `@storybook/addon-vitest` runs every story
as a browser test, and its peer range is Vitest 3 and 4; this repository is on
Vitest 5. A preview only, until the addon takes Vitest 5.

## Acceptance

- [ ] `pnpm --filter @signalscout/ui storybook` opens a preview of every
      exported component, and `storybook:build` builds a static one.
- [ ] The preview wears the package's own stylesheet and Figtree, so what it
      shows is what an application shows.
- [ ] Every component exported today has a story per state a screen puts it
      in: `Button`, `Dialog`, `Field`, `FormError`, `PageState`, `BrandIcon`,
      `BrandLogo`, `ProjectCard`, `ReplyDraft`, `ReplyVoices`.
- [ ] A component that fetches is shown without a server.
- [ ] Nothing Storybook installs reaches the published tarball:
      `pnpm release:verify:ui` passes and the tarball lists no story.
- [ ] `pnpm check:licenses`, `pnpm lint`, `pnpm typecheck` and `pnpm test`
      pass.
- [ ] The package README says how to run the preview and that a new
      component comes with its stories.
- [ ] The preview was opened in a browser; the Log says what was seen.

## Notes

- `packages/ui`: `package.json`, `README.md`, `.storybook/`, `src/**/*.stories.tsx`.
- The fixtures in `@signalscout/ui/testing` are the stories' data too.

## Log

- 2026-09-23T13:51+08:00 — Written after a survey of the two applications,
  with US-352 to US-355. The owner chose Storybook from the table above.
