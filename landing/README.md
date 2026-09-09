# SignalScout landing page

Standalone Astro static site. This folder has its own npm lockfile and is
outside the pnpm application workspace. It imports no application packages,
needs no backend and reads no application secrets.

## Local development

Use Node 24 or later. From this folder:

```sh
npm ci
npm run dev
```

Astro serves the page at `http://localhost:4321`.

```sh
npm run check
npm run build
npm run preview
```

The production output is `dist/`.

## Vercel

Import the repository as a separate Vercel project. Set **Root Directory** to
`landing` and use Node 24. Leave access to files outside the root directory
disabled. `vercel.json` supplies:

- Framework preset: Astro
- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: `dist`

Set `PUBLIC_APP_URL` to the hosted application. It is
`https://app.signalscout.run` on this project, set on 2026-09-10 when the cloud
version went live.

**Astro reads it at build time, so changing it needs a redeploy** — a value
edited in the Vercel dashboard reaches nobody until the next build. Until it is
set the page says cloud signup is coming soon and links nowhere, which is the
right answer for a deployment that has no hosted application rather than a
broken link to one.
No server adapter or API deployment is needed for the landing page.
Attach the marketing domain in the Vercel project settings when ready.
The folder is the deployment root; the page is served at `/`, not `/landing`.

Astro documents static deployment at
[Deploy to Vercel](https://docs.astro.build/en/guides/deploy/vercel/).

## Content and design

`src/pages/index.astro` owns the copy, repository links and illustrative inbox.
The main action opens pricing: Self-hosted is free, and SignalScout Cloud is
$15 USD per month after a seven-day trial. The trial figure is US-072's, held
in `trialDays` in `packages/core/src/billing/entitlement.ts`; change the page
only when that constant changes. The page claims no card is asked for, which
is true because sign-up writes the trial row itself and creates nothing in
Stripe until somebody opens Checkout. The FAQ says what running out does:
monitors stop and writes are refused, while reading and exporting stay open. Both plans bill social data and AI usage separately through
the customer's provider accounts. Cloud is presented as available at launch,
on the owner's instruction. Billing itself is outside this site.

The self-hosted action links to the repository's running instructions. Update
the `repository` constant if that location changes. The Cloud action reads
`PUBLIC_APP_URL`. Until that URL is supplied, the page shows “Cloud signup coming soon” instead of a signup link.
Set it to the real signup or checkout destination before publishing.

`src/styles/tokens.css` is a snapshot of the application palette and sizing
tokens, copied so the site builds alone, plus a small marketing accent palette
(coral, mint, lavender and pale yellow). Review it when the application theme
changes. `src/styles/landing.css` owns the landing layout and interactive example styles;
`features.css` styles the feature overview. Large headlines and stacked conversation
cards lead into the inbox demo, three-step workflow, features, pricing, and FAQ.
Copy stays short within each section. Figtree is bundled
locally through `@fontsource/figtree`. Platform icon provenance is recorded in
`public/brands/README.md`; only the six platform icons are copied here.

The hero deck and the inbox demo answer two different questions, so they use
different content. The hero carries one post per platform and a different
product behind each one — a booking app, an error monitor, a hiring tracker, a
subtitle editor, a skincare line, a meal planner — because the headline claims
that somebody is asking for whatever the reader built. Each card names its
product, so the post reads without outside context. The inbox demo below is one
monitor, so it stays on a single product: a simple invoicing app for
freelancers, from chasing late payments to looking for a cheaper alternative.
Every post and score on the page is illustrative. Selecting a conversation
updates the preview locally. FAQ disclosures use native HTML. The page makes
no provider requests and collects no visitor data.

The hero rotates through those six illustrative posts every 3.5 seconds.
Pause and Next controls are available. Rotation pauses on hover, keyboard focus,
when off-screen, and in hidden tabs. Reduced-motion preference starts it paused
and removes card transitions. With JavaScript disabled, the first card remains visible.

Supporting text uses a 14px minimum at the default browser size. Body copy is
16–18px. These sizes use rem-based tokens so browser text-size preferences
apply. Cards and captions wrap rather than shrinking their type on phones.

## The social card

`public/og.png` is what a link to this site unfurls into on X, LinkedIn, Slack
and every other preview. **1200×630**, PNG — X and LinkedIn both refuse SVG, and
a card at another ratio is cropped by each platform in its own way.

Replace the file and redeploy. Nothing in the page needs editing: the `<head>`
builds the absolute URL from the site's own origin, and the dimensions are
declared so a preview reserves the right space before the file downloads.

Two things to know when it changes. The **alt text** in `index.astro` describes
the current image, so a new card needs a new sentence. And every platform
**caches** what it scraped: X's Card Validator and LinkedIn's Post Inspector
both force a re-fetch, and without one an old card can persist for days.

## Metadata

The title, the description and the card all live in the `<head>` of
`src/pages/index.astro`, and the description is written once and reused by
search results, Open Graph and X.

`site` is the canonical origin and names the **`www`** host on purpose: the
apex answers 308 to it, so pointing the canonical at the apex would aim every
link and every crawler at a redirect.

The JSON-LD block carries both plans, which is the one place the cloud price is
repeated outside the pricing card. The application reads its price from Stripe
rather than stating it; a static build cannot, so changing the price means
changing both.
