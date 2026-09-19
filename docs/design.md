# Site design

The intent inbox establishes the visual direction: white reading surfaces,
cool neutral backgrounds, muted blue for actions and selection, and restrained
borders. The goal is to make the next useful action obvious while keeping
secondary information available on demand.

## Source of truth

- `apps/web/src/styles/tokens.css`: semantic colors, Figtree typography, spacing,
  radii, control heights, page gutters, navigation sizes and reading width.
- `apps/web/src/styles/theme.css`: shared headers, buttons, view switches,
  disclosures and keyboard focus treatment.
- `apps/web/src/index.css`: base layout, navigation and existing page styles.
  It imports the tokens. `main.tsx` imports the shared theme after page styles
  so ordinary page rules cannot accidentally restore the older control theme.

Use tokens rather than introducing another gray, blue, radius or shadow in a
page. Platform brand colors and semantic warning/success colors may differ
from the site accent. The theme is currently light only.

## Components

A screen uses a shared component before it writes a theme class by hand. The
components live in `apps/web/src/components/` and own the class names and the
semantics a screen must not get wrong:

- `Button` — the three control intents (`primary`, `secondary`, `compact`). A
  page names the intent and never the class. `type` defaults to `button`, so a
  form's submit button says `type="submit"` explicitly.
- `Dialog` — the only path to a modal. It owns the native `<dialog>`, the
  heading row, the Close button and `aria-labelledby`. A screen passes the
  heading content, the body and a ref it opens with `showModal`. A new dialog
  is never `role="dialog"` on a div with its own Escape listener.
- `Field` — the label-plus-control shape. The label is a `<span>`, an optional
  `<small>` carries supporting text, and the control is children.

`docs/design.md` is the rule; the migration happens one screen at a time. A
theme class not served by a component (e.g. a page's own `text-button`) stays a
plain class until a component earns it. Components never import `packages/pipeline`.

## Spacing

Spacing is on the scale, not on a value. The scale lives in
`apps/web/src/styles/tokens.css`:

| Token | `--space-1` | `--space-2` | `--space-3` | `--space-4` | `--space-5` | `--space-6` | `--space-8` | `--space-12` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Value | 4 | 8 | 12 | 16 | 20 | 24 | 32 | 48 |

**A `padding`, `margin` or `gap` is either `0` or a `var(--space-*)` token,
never a raw px number.** Two lengths are not spacing and stay raw: a
hairline of 1–2px for a border or an outline, and a non-spacing length —
a radius, a width, a height, a shadow offset, a control's `min-height`.

**A value that does not fit moves to the nearest step.** When it sits exactly
between two, read what it measures: a tight gap between small inline controls
is `--space-1` or `--space-2`; an inset around a control, a card or a section
is `--space-4` or `--space-5`. Do not invent a token for a value the scale
already covers — the scale is coarse on purpose, and the answer to "9px or
11px?" is whatever the scale offers. The detail that justifies a value you
care about is worth a comment, not a new token.

The scale is what makes the site read as one site. 9px beside 8px does not
visibly disagree; 9px beside 11px does, and after a hundred edits no two gaps
match.

**`pnpm lint:css` enforces it**, because Biome has no CSS rule for this. The
stylelint script names its files explicitly: `index.css` and the un-migrated
page stylesheets are grandfathered, since a page that still uses old values
cannot be enforced until it has adopted the scale. When a page is migrated,
add its stylesheet to the `lint:css` command and to the migration list below.
A new rule in a migrated file that uses a raw px spacing value is a lint
error.

Two things stay out of it: the email templates, which are a separate renderer
that cannot read the CSS scale and copy the palette rather than the spacing;
and `packages/pipeline`, which has no UI.

## Shared patterns

| Pattern | Use |
| --- | --- |
| `.topbar`, `.page-subtitle` | One page title, a short supporting sentence, and an optional action. Responsive gutters are shared. |
| `.primary-button` / `.top-primary-button` | The main action, solid blue, without a decorative shadow. Use a button for an action and an anchor for navigation. |
| `.secondary-button` / `.top-secondary-link` | Supporting actions, with a quiet outline. |
| `.compact-button` | Toolbar actions such as Filters. Use `aria-expanded` and `aria-controls` when revealing a panel. |
| `.view-switch` | A labelled fieldset of buttons switching views. Mark the active button with `aria-pressed`. These are buttons, not ARIA tabs. |
| `.disclosure` | Native `details` / `summary` for optional detail. A span in the summary can carry a trailing value. |

The inbox uses these shared patterns directly; its list density, column ratio,
preview truncation and mobile reading pane remain page-specific.

```tsx
<header className="topbar">
  <div>
    <h1>Page title</h1>
    <p className="page-subtitle">A short explanation of this page.</p>
  </div>
  <button className="primary-button" type="button">Main action</button>
</header>
```

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
- The bottom bar holds four items: Projects, Intent inbox, Monitors and
  Account. New monitor is not one of them, because the inbox header, the
  monitor list header and every project card already carry that action.
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
