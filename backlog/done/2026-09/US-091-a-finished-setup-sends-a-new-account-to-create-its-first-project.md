---
id: US-091
title: A finished setup sends a new account to create its first project
type: feature
priority: p2
created: 2026-09-09T18:23+08:00
resolution: shipped
---

## Context

**A new account finished setup and met an empty list.** US-088 asks for two
keys, and when the last one is saved the gate closes. A brand-new account then
lands on the projects list and its empty state, which asks it to press a
button. The next honest step after "who are you and what reads your
conversations" is describing a business, so the owner asked that finishing
setup go straight to the create-project screen.

**The create form had no address.** It was a state of the projects list: the
screen kept an `editorOpen` flag and swapped its own content. A redirect needs
a destination that is a real page, and no link could name a state. So the
editor became a page — `/projects/new` to create, and `/projects/:id/edit` for
the edit mode that shares the same form. The list became a list, linking to
both.

**The gate is not a route and cannot navigate.** It replaces the whole
application, the way the login does. The redirect therefore watches the gate
*closing* rather than any button. This matters more than the code suggests:
the "Start using SignalScout" button that closes the gate is effectively
unreachable, because the gate leaves the moment both keys are on the views —
the finish needs both keys, and storing the last one provides them. So the
event that ends setup is a key being saved, and the redirect is attached to
that event.

**Two rules keep the redirect honest.** An account with projects that re-adds
a deleted key is not a new account, so the redirect fires only when the
finished account holds no project — read at the moment the gate closes, once.
And a later load never redirects: the moment is the gate closing, not "has no
project", so a person who refreshes after setup is not herded back to the
create form.

**`/projects/new` is a static segment under a dynamic parent.** The inbox route
is `/projects/:projectId`, and a pattern-based read like `useProjectId` will
happily read "new" as a project id. If it did, the project-scoped links would
appear on the create page pointing at a business that does not exist. The
create page must carry no project.

## Acceptance

- [x] New project and edit project each have their own address, registered in
      `route.ts` and `App.tsx`; the projects list links to both and holds no
      editor of its own.
- [x] `/projects/new` shows the create form, and `/projects/:id/edit` loads
      the project from `GET /api/projects/:id` and shows it prefilled.
- [x] The create page carries no project-scoped links; the edit page carries
      the edited project's.
- [x] An account that finishes the setup gate with no project lands on
      `/projects/new`.
- [x] An account that finishes the gate with at least one project is not
      redirected.
- [x] A later load, where the gate never opened that session, never redirects.
- [x] A created project goes to its own inbox, which offers the first monitor;
      a saved edit returns to the projects list.
- [x] Editing a project that cannot be read shows the error and offers no blank
      form, so it cannot silently create a second project.
- [x] The web suite passes, and lint, typecheck and build are clean.

## Notes

The redirect lives in `App.tsx` as an effect that watches the gate close and
reads `/api/projects` once. A read that fails redirects to nothing: the
projects list is the honest landing, and it says so itself.

`useProjectId` in `App.tsx` returns null on `/projects/new`, which is what
keeps the create page free of project-scoped navigation. The Projects nav item
stays current on both editor pages.

One question is left open on purpose. If the "Start using SignalScout" finish
button is wanted as a real step, the gate must be taught to stay up after the
keys are in; today it cannot be pressed because it is gone before it renders
complete. That is a product decision nobody has made.

## Log

- 2026-09-09T18:23+08:00 — Written after the work, which the owner chose to do
  without a ticket first.
- 2026-09-09T18:30+08:00 — Done. `Projects.tsx` splits into the list and a
  `ProjectForm` shared by both modes; `route.ts` gains `/projects/new` and
  `/projects/:projectId/edit`; `App.tsx` registers them, keeps the Projects
  nav current on both, and redirects to the create page when the setup gate
  closes over an account with no project.

  Creating a project navigates to the new project's inbox, whose empty state
  offers the first monitor; saving an edit returns to the list. Editing a
  project whose `GET /api/projects/:id` fails renders no form, because a blank
  form would `POST` a second project on "Save changes".

  The setup gate's finish is the closing moment, not a button. The effect sets
  a `wasGated` flag while the gate is on screen, so the redirect fires exactly
  once per setup and never on an ordinary load.

  Tests: the list and the two editor pages have their own files
  (`Projects.test.tsx`, `ProjectForm.test.tsx`), and `App.test.tsx` proves the
  gate redirect for an account with and without projects, the no-redirect on a
  later load, and both editor addresses through the router. The full web suite
  passes — 16 files, 284 tests — and lint, typecheck and `pnpm build` are
  clean.
