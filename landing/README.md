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

Set `PUBLIC_APP_URL` to the hosted signup or checkout URL before launch.
Astro reads this public value at build time; redeploy after changing it.
No server adapter or API deployment is needed for the landing page.
Attach the marketing domain in the Vercel project settings when ready.
The folder is the deployment root; the page is served at `/`, not `/landing`.

Astro documents static deployment at
[Deploy to Vercel](https://docs.astro.build/en/guides/deploy/vercel/).

## Content and design

`src/pages/index.astro` owns the copy, repository links and illustrative inbox.
The main action opens pricing: Self-hosted is free, and SignalScout Cloud is
$15 USD per month. Both plans bill social data and AI usage separately through
the customer's provider accounts. Cloud is presented as available at launch,
on the owner's instruction. Billing itself is outside this site.

The self-hosted action links to the repository's running instructions. Update
the `repository` constant if that location changes. The Cloud action reads
`PUBLIC_APP_URL`. Until that URL is supplied, it stays on the pricing section.
Set it to the real signup or checkout destination before publishing.

`src/styles/tokens.css` is a snapshot of the application palette and sizing
tokens, copied so the site builds alone. Review it when the application theme
changes. `src/styles/landing.css` owns the marketing layout. Figtree is bundled
locally through `@fontsource/figtree`. Platform icon provenance is recorded in
`public/brands/README.md`; only the six platform icons are copied here.

The inbox runs on illustrative posts and scores. Selecting a conversation
updates the preview locally. FAQ disclosures use native HTML. The page makes
no provider requests and collects no visitor data.
