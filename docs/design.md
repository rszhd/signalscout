# Screens and layout

What this application's screens do and how they are arranged. **The brand is
not here**: the palette, the type and spacing scales, the shared controls and
the mark live in [`@signalscout/ui`](../packages/ui/README.md), which the
hosted application wears too (US-270). Read that first; this page is what
sits inside it.

## Layout and interaction rules

- Typography uses rem-based tokens: supporting metadata starts at 14px,
  secondary copy at 15px, labels and body text at 16px, and conversation reading
  text at 17px with the browser's default font size. Keep smaller sizes only
  for decorative icon glyphs. Let controls and rows grow or wrap with the text.
- Pair readable type with space: separate card sections by 24px and use 32px
  card padding on desktop. Stack project cards before their summaries become
  cramped. On phones, setup progress shows every step number and only the
  current step's label; all labels remain available to assistive technology.
- Give content more visual weight than metadata. Use body text for the content
  and smaller muted text for source, age and supporting context.
- Use `--surface` for reading, `--background` for the shell, `--surface-soft`
  for supporting information and `--accent-soft` for selection.
- Use the `--space-*` scale for new spacing and `--page-gutter` for page edges.
  Keep desktop reading content within `--reading-width` where appropriate.
- Avoid a card around every section. Use whitespace first, dividers second.
- Put the main action near the content it acts on. Keep diagnostic numbers
  and less-used settings behind an explicit disclosure.
- Keep selected, saved and dismissed states legible without relying on color.
  Preserve native semantics and visible keyboard focus.
- At 820px and below, navigation moves to the bottom. Layouts must work at
  320px without horizontal page scrolling. Respect reduced-motion preferences.
- The bottom bar holds four items: Projects, Inbox, Monitors and
  Account. New monitor is not one of them, because the monitor list header
  and every project card already carry that action.
  Account opens a sheet with Providers, Voices, Models and Sign out —
  the sidebar's account section, which a phone does not show.
- A table wider than the screen becomes one card per row below 600px. Each
  cell carries its column name in `data-label` and the stylesheet prints it
  with `::before`. Changing `display` on a table drops the table semantics, so
  the table, its row groups, rows and cells name their roles explicitly.
  Monitors and Providers are the two that do this.

## Migrating the remaining pages

Shared tokens, headers and buttons already apply across the site. Notifications still has older page-specific layout and styling. Update them one at a time; this foundation does not claim
those pages have been redesigned.

For each page, adopt the shared patterns, replace local neutral colors and
control styling with tokens, and remove obsolete overrides. Change a shared
pattern in `theme.css` when every page should benefit; keep content arrangement
in the page styles. Do not duplicate an inbox-prefixed selector to build a new
page's controls.

Check the changed page at desktop and phone sizes, plus its loading, empty and
error states. Run the existing web tests, typecheck and production build.
Presentation-only changes do not need tests that assert CSS values.

## New monitor

New monitor is a full page with five steps: Product, Signals, Sources, Search
plan, and Schedule & budget. `styles/monitor-setup.css` owns the step layout and
reads the shared theme. Back retains answers and query edits during setup;
unchanged generation inputs reuse the current plan. Navigating away or
refreshing does not save a draft. Escape does not leave the page.

Each platform's plan expands independently. Invalid queries open their section
before asking for correction. Schedule, cap and the optional paid sample test
are together on the final step. A quote for a different schedule or edited
plan is marked stale. Creation is always an explicit final action.

## Connections

Connections lists provider accounts as compact rows. Each row names the
platforms, configuration status and masked key origin. Connect or Manage opens
a native dialog for testing, pasting, replacing and removing keys. Opening a
dialog makes no API call. Responses appear inside the dialog, and editing a key
clears the previous test result. Close and Escape dismiss the dialog and return
focus to its trigger.

Platform choices are separate from accounts. Change opens a dialog with the
available providers and any blocker. Keep the server’s provider selection rules,
environment-key fallback and test-before-save behavior intact.
`styles/connections.css` owns this page layout and uses the shared theme.

## Provider and platform icons

Use `BrandIcon` with the provider/platform ID (or a platform display name).
Original downloaded favicons live in `apps/web/public/brands`; that folder's
README records their source URLs and ownership. Icons are served locally and
remain decorative beside a visible name. Unknown or failed images fall back to
initials. Use 16px beside metadata, 20–24px beside platform names, and 26px in
provider account avatars. Do not use a third-party favicon service at runtime.

## Projects

Projects opens on a two-column grid of businesses, product and audience summaries,
and monitor counts. Cards stack on phones. Each card links to its inbox and a
prefilled new monitor. Creating or
editing switches to a white form surface with brief guidance alongside it on
desktop; document import and conversation signals
are optional disclosures. Saving returns to the list, while a failed save
retains the answers. Cancel clears the draft. Changes apply to future monitors;
existing monitors keep their copied answers. `styles/projects.css` owns the
layout and uses the shared theme.

## Monitors

Monitors groups compact cards by project, with search across names, projects and
platforms and a status filter. The overview and filter counts follow the selected
project. Status, estimated spending, remaining budget and feedback stay visible;
schedule, budget, pre-filter controls and collection history sit behind a native
disclosure. Budget, credential and notification issues remain outside it.
`styles/monitors.css` owns the responsive layout and uses the shared theme.

## Models

Models shows saved keys and a compact list of jobs with their current model
and provider. Each job opens a modal to edit its settings, with native focus containment,
Escape to close and a visible Close button. Model and provider use native
selects with shared control styling; “Custom model…” reveals a model-name input. Adding a key
opens its own modal. Advanced settings stay
inside the job editor. Preserve inheritance, provider compatibility, paid tests,
save feedback and reset actions. `styles/models.css` owns the responsive layout
and uses the shared theme.
