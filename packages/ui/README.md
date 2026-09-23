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
not: a layout, a page stylesheet and a route table belong to each
application. **A navigation's parts and look are shared; its structure is
not** (US-355): the items, their icons, the signed-in person, signing out, the
sidebar, the phone's bottom bar and the account sheet are here, and which
items a navigation shows, in which order and under which heading is each
application's shell.

**The rule that keeps it one brand: a control here uses a token name and
never a raw colour or a raw spacing value.** `pnpm lint:css` says it to CI.
An application that needs a new colour or a new step asks this package for
it rather than writing the value into a screen.

## Source of truth

- `src/styles/styles.css`: **the one stylesheet an application imports.** It
  imports the two below and every component's rules, in cascade order. One
  export on purpose (US-279): Vite caches a dependency's `exports` for the
  life of the process, so a new export per component needed a dev-server
  restart and looked like a crash. A component's rules are one line here.
- `src/styles/tokens.css`: semantic colors, Figtree typography, spacing,
  radii, control heights, page gutters, navigation sizes and reading width.
- `src/styles/theme.css`: shared headers, buttons, view switches,
  disclosures and keyboard focus treatment.
- each application's `index.css`: base layout, navigation and its own page
  styles. Its `main.tsx` imports `@signalscout/ui/styles.css` once, after the
  base styles and before the page styles.

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

## The preview

Every exported component renders on its own in Storybook, with fixture data
and no server (US-351):

    pnpm --filter @signalscout/ui storybook        # http://localhost:6006
    pnpm --filter @signalscout/ui storybook:build  # a static copy in storybook-static/

**A new component comes with its stories**, one per state a screen puts it
in: loading, empty, refused, the confirmation that replaces the actions. A
story sits beside its component as `<Name>.stories.tsx`. `tsconfig.json`
leaves the stories out of `dist`, and `tsconfig.stories.json` typechecks them.

- **A component that fetches** names its answers in `parameters.api`, keyed
  by method and path; `.storybook/api.ts` answers in place of `fetch`. A call
  no story names answers 404 and warns in the console.
- **The preview wears what an application wears**: this package's
  stylesheet, over Tailwind's reset and Figtree. A component that looks wrong
  here and right in an application depends on a rule the application holds,
  and that rule belongs here (BUG-356 was the first).
- **The stories are not tests yet.** Storybook's Vitest addon supports
  Vitest 3 and 4, and this repository is on 5.

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

**`pnpm lint:css` enforces it**, because Biome has no CSS rule for this. It
reads every stylesheet in `packages/ui/src/styles` and `apps/web/src/styles`,
so a new page stylesheet is checked from its first line. A raw px spacing
value there is a lint error. One file is outside it: the application's
`index.css`, which still holds older values.

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
- **Its stylesheet ships with it**, as its own file under `src/styles/` and
  one line in `styles.css`, rather than growing `theme.css`, which stays about
  primitives. A composed component and its rules travel together or they
  drift.
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
the navigation. `ReplyDraft` is the second (US-278): the composer a match opens,
which followed the hosted layout before it moved, so the package holds the
newer one.

## The parts of a screen

The inbox is not one screen in the package: its filters, its paging and its
address carry the product. Its parts are (US-352). `MatchCard` is a row of the
list, `MatchDetail` the reading pane, and `MonitoringBar` the line above both.
Each application's `Inbox` holds the state and the requests and renders them.

- **The page decides; the part shows.** `MatchDetail` calls back with a
  verdict or a save and changes nothing itself, so a refused request leaves
  the pane as it was. `saving` and `judging` are the page's answer to "is one
  in flight".
- **A product's own action is a slot.** `MatchDetail`'s `actions` sits beside
  the conversation link: self-hosted it holds *Copy link*.
- **An address is a prop.** `MonitoringBar` takes `monitorHref`, because the
  hosted product opens its one monitor's list and this one opens the monitor.
- **The look is the hosted one**, whose `inbox.css` refined an older layer of
  the same rules. The two layers are one file, `match.css`, and no rule needs
  an `.inbox-page` ancestor, so the preview shows a part as a page does.

The monitor page's parts followed (US-353): `MonitorStatus`, the status word
every monitor screen shows; `MonitorHistory`, the polls and their stages;
`QueryPerformance`, what each search input finds; and `LeadSources`, where the
matches come from. **They fetch nothing.** The two APIs answer these reads in
different shapes — the self-hosted one pages the history and sends a score
floor — so each application keeps the request and hands the rows in, and what
only one API sends is an optional prop: `more` and `onShowOlder`, a query row's
`note`, the lead groups to offer. Their rules are in `monitor-parts.css`.

Three more followed (US-354). `Notifications` is a whole screen, like
`ReplyVoices`: both products call the same two routes, so it fetches for
itself, and the fields only the self-hosted API sends are optional. The
page passes the monitor's address and, self-hosted, the sentence for an
account signed with the instance's own secret. `LoginFrame` is the page
around a sign-in form; the form is the child and stays each application's.
`DraftFromDocument` drafts a project's four answers from a page or a file;
where it sits, and the space around it, is the page's.

The navigation's parts came last (US-355): `NavItem` (a link, or a button
that opens something), `NavIcon`, `AccountIdentity` and `SignOut`, with
`sidebar.css` for the sidebar, the bottom bar and the account sheet. The
shell that places them stays each application's, because the two navigations
hold different things; an item only one of them has keeps its rules there.

## The words

`monitor.ts` holds what both products *say* about a monitor, a poll, a stage
and a match: the status word, the poll sentence, the stage sentence, the
badge, the ages and the money. `schedule.ts` holds the words for when a
monitor runs — the rate list, the day rules and "Polls every hour — about 731
polls a month" — and not the control that lets a person choose one, which the
hosted product no longer offers (US-173 there). They are here for the reason the tokens are —
a sentence written twice becomes two sentences, and "Found nothing" beside
"Running" about one monitor is the failure US-104 exists to prevent.

`match.ts` holds the words about one match: where it came from
("Reddit · r/devops"), how much of a reply's thread was read and why it
stopped, whether the link can open the reply or only the post, and how much of
a post the pane shows before *Read more*. `band`, the two words for a score,
stays in `monitor.ts`.

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
