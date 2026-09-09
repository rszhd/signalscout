# Spacing

Spacing is on the scale, not on a value. The scale lives in
`apps/web/src/styles/tokens.css`:

| Token | Value |
| --- | --- |
| `--space-1` | 4 |
| `--space-2` | 8 |
| `--space-3` | 12 |
| `--space-4` | 16 |
| `--space-5` | 20 |
| `--space-6` | 24 |
| `--space-8` | 32 |
| `--space-12` | 48 |

## Rule

A `padding`, `margin` or `gap` is **either** `0` **or** a `var(--space-*)`
token. It is never a raw px number.

Two things are not spacing and stay as raw values:

- A hairline, 1–2px, for a border or an outline width.
- A non-spacing length: border radius, a width, a height, an offset in a
  shadow, a `min-height` fixed to a control.

## Snapping a value that does not fit

Move to the **nearest** scale step. When a value sits exactly between two
steps, read what it measures and choose:

- A tight gap between small inline controls — `--space-1` or `--space-2`.
- An inset around a control, a card, or a section — `--space-4` or `--space-5`.

Do not invent a new token for a value the scale already covers. The scale is
intentionally coarse; the answer to "9px or 11px?" is "whatever the scale
offers."

## Why

The scale is what makes the site read as one site. A page that uses 9px and a
neighbour that uses 8px do not visibly disagree, but a page that uses 9px and
another that uses 11px do, and after a hundred edits the gaps are all different
and none of them match. The detail that justifies a value you care about is
worth a comment, not a new token.

## Enforced

Biome has no CSS rule for token-vs-px spacing, so the check is stylelint.

`pnpm lint:css` runs stylelint over the stylesheets that have adopted the
scale. A raw px spacing value in one of them fails the run.

The script names the files explicitly, because `index.css` and the un-migrated
page stylesheets are grandfathered — a page that still uses old values cannot
be enforced until it has adopted the scale. When a page is migrated, its
stylesheet is added to the `lint:css` command and to `docs/design.md`'s
migration list.

Run it locally, or as part of CI alongside `pnpm lint`:

    pnpm lint:css

## Out of scope here

- `index.css` — the legacy page-styles bucket. It is migrated page by page; a
  full sweep is a large diff with high visual-change risk. Until a page is
  migrated it is exempt.
- The email templates — they are a separate renderer and cannot read the CSS
  scale. They copy the palette, not the spacing.
- `packages/core` — it is not React and has no UI.
