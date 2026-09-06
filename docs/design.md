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

## Migrating the remaining pages

Shared tokens, headers and buttons already apply across the site. Monitors,
Connections, the monitor form and Notifications still have older page-specific
layout and styling. Update them one at a time; this foundation does not claim
those pages have been redesigned.

For each page, adopt the shared patterns, replace local neutral colors and
control styling with tokens, and remove obsolete overrides. Change a shared
pattern in `theme.css` when every page should benefit; keep content arrangement
in the page styles. Do not duplicate an inbox-prefixed selector to build a new
page's controls.

Check the changed page at desktop and phone sizes, plus its loading, empty and
error states. Run the existing web tests, typecheck and production build.
Presentation-only changes do not need tests that assert CSS values.
