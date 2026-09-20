# @signalscout/ui

SignalScout's brand: the token contract, the shared controls, the mark, and
the words both applications say about a monitor.

## The direction

The intent inbox establishes the visual direction: white reading surfaces,
cool neutral backgrounds, muted blue for actions and selection, and restrained
borders. The goal is to make the next useful action obvious while keeping
secondary information available on demand.

**Two applications wear this, and their screens differ.** The open-source
application and the hosted one are forks of one app (US-151, US-239) and are
meant to look like one product. So the brand lives here and the screens do
not: a layout, a page stylesheet, a route table and a navigation shell belong
to each application.

**The rule that keeps it one brand: a control here uses a token name and
never a raw colour or a raw spacing value.** `pnpm lint:css` says it to CI.
An application that needs a new colour or a new step asks this package for
it rather than writing the value into a screen.

## Source of truth

- `src/styles/tokens.css`: semantic colors, Figtree typography, spacing,
  radii, control heights, page gutters, navigation sizes and reading width.
- `src/styles/theme.css`: shared headers, buttons, view switches,
  disclosures and keyboard focus treatment.
- each application's `index.css`: base layout, navigation and its own page
  styles. It imports `@signalscout/ui/tokens.css`, and its `main.tsx` imports
  `@signalscout/ui/theme.css` after the page styles so an ordinary page rule
  cannot accidentally restore an older control theme.

Use tokens rather than introducing another gray, blue, radius or shadow in a
page. Platform brand colors and semantic warning/success colors may differ
from the site accent. The theme is currently light only.

## Components

A screen uses a shared component before it writes a theme class by hand. The
components live in `src/components/` and own the class names and the
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
`src/styles/tokens.css`:

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

## Components beyond the primitives

`ProjectCard` is the first, and it sets the pattern for the next one. US-273.

- **The product's answers are slots.** The hosted product is one monitor per
  project, so its status line is that monitor's state and its second action
  opens it; self-hosted a project holds several, so the status is a count and
  the action makes the next one. The card knows neither. It knows the shape.
- **Its stylesheet ships with it and is imported by name** —
  `@signalscout/ui/project-card.css` — rather than growing `theme.css`, which
  stays about primitives. A composed component and its rules travel together
  or they drift.
- **It holds no state.** The open confirmation is a prop, so the page keeps
  deciding which card is asking.
- **It links with the router**, which is why `react-router` is a peer: a card
  whose name is a plain anchor reloads the application on a click.

`PageState` and `FormError` came next (US-276): what a screen says while it
waits, when it has nothing, and when the server refused, and a refusal inside a
form. They were written by hand fifty-eight times across the two
applications. The role each carries — `status` for waiting and empty, `alert`
for an error and a refusal — is the one thing they decide and a caller cannot
change, because it is the part a screen cannot be trusted to remember and the
part a screen reader needs.

What stays with the page: the list's grid, its heading, a success screen with
a mark of its own. Those are layout.

## A screen that is the same screen

`ReplyVoices` is a whole screen, and the first (US-277). It may be one because
it carries no product decision: a voice is a name and an instruction, stored
per account, and nothing about who pays for a model touches it. The rule in
both `AGENTS.md` files says it this way — a screen that is the same screen in
both products may be shared; a screen that carries the product may not. The
route that renders it stays each application's own, and so does its place in
the navigation.

## The words

`monitor.ts` holds what both products *say* about a monitor, a poll, a stage
and a match: the status word, the poll sentence, the stage sentence, the
badge, the ages and the money. `schedule.ts` holds the words for when a
monitor runs — the rate list, the day rules and "Polls every hour — about 731
polls a month" — and not the control that lets a person choose one, which the
hosted product no longer offers (US-173 there). They are here for the reason the tokens are —
a sentence written twice becomes two sentences, and "Found nothing" beside
"Running" about one monitor is the failure US-104 exists to prevent.

Where the products differ, the difference is an argument and never a fork:

| Difference | How |
| --- | --- |
| The hosted product shows a share of an allowance, never a dollar | `pollSummary(run, { spend: false })`, and the same option on `monitoringState` |
| Only the hosted product can pause a monitor by plan | `Monitor.pausedByPlan`, absent self-hosted |

## What a consumer must provide

- **A bundler that defines `import.meta.env`,** which in practice is Vite.
  `BrandIcon` reads `BASE_URL` to find the icon files; nothing else here
  needs one, and the words import nothing at all.
- **React 19**, as a peer dependency. Two Reacts in one bundle is two
  renderers and a hook that throws.
- **`public/brands/`** — the provider and platform icons `BrandIcon` names,
  listed in its own table.
- **`public/brand/mark.svg` and `mark-small.svg`** — copied from this package's
  exported assets. `BrandLogo` and browser metadata deliberately address the
  same public files, so the application logo cannot drift from its favicon.

## The mark

`BrandLogo` renders the canonical `mark.svg`: nine positions on a lattice,
one of them found. The package also ships `mark-small.svg`, whose four-dot cut
survives at favicon size. They are exported as `@signalscout/ui/mark.svg` and
`@signalscout/ui/mark-small.svg`; applications copy them into `public/brand/`
alongside their generated PNG and ICO variants.

The SVG owns the two mark colours. Those are artwork, not control colours;
the values deliberately match `--accent-tint` and `--accent`. Keeping the SVG
in the package makes that duplication visible and releaseable instead of
letting each application redraw it.
