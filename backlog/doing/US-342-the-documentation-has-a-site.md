---
id: US-342
issue: 90
title: The documentation has a site, at docs.signalscout.run
type: feature
priority: p1
created: 2026-09-23T10:50+08:00
parent:
area: docs
resolution:
---

## Context

**The documents were written for the people who build SignalScout, and a
person who wants to run it reads them too.** `docs/self-hosting.md` sits
beside `docs/testing.md`, and a page that answers "how do I install this"
also carries the reasoning an agent needs before editing a route. A
self-hoster, and since the cloud launched a paying customer, has no page
written for them.

The owner decided the shape on 2026-09-23:

- **One site for self-hosters and cloud users**, at `docs.signalscout.run`.
  Contributor rules stay in the repository, where the code links to them.
- **The source is in this repository**, so a contributor can fix a page in
  the same pull request as the code it describes.
- **VitePress, plain Markdown.** A page is one `.md` file an agent reads
  as it is. No Vue component inside a page, so the source stays prose.
  The build writes `llms.txt`, so an agent reading the live site gets the
  same text.
- **Split and trim.** What a user needs moves to the site and is rewritten
  for them; what a contributor needs stays at its current path, because 133
  files and 616 references in code, config and skills name those paths.

**The site lives in `site/`, outside the pnpm workspace**, with its own npm
lockfile, as the cloud's landing page does. The workspace globs `apps/*`,
and the image installs the workspace with `--frozen-lockfile` from manifests
it copies by name; a documentation generator in that install is a slower
image build for nothing it serves.

**A page mixes text, screenshots and diagrams**, on the owner's request: a
page of text alone is tiring to read. A diagram is a Mermaid block, so it
stays text an agent reads and updates beside the code; D2 draws nicer layouts
but needs its own binary in the build, and Excalidraw's source is JSON drawn
by hand. Excalidraw is kept for a hero picture that rarely changes. A
screenshot is taken by a script from an instance holding invented data, never
a real person's post.

**The cloud pages say what differs and link to the pricing page.** This
repository charges nobody, and the landing page owns the prices; a copy here
would go stale in silence.

This ticket is the skeleton: the site builds, wears the brand, has its
navigation and one real page, and deploys. The pages are US-343 to US-346.

## Acceptance

- [ ] `site/` builds with `npm ci && npm run build` and writes `llms.txt`
      and `llms-full.txt`.
- [ ] The site wears the brand's colours and mark, from `packages/ui`.
- [ ] A ` ```mermaid ` block renders as a diagram in the brand's colours and
      font, with no label cut off.
- [ ] A page is plain Markdown; `site/README.md` says the rules for writing
      one.
- [ ] Every internal link in the built site resolves (VitePress fails the
      build on a dead link).
- [ ] The root image build and `pnpm install` are unchanged.
- [ ] The site is served at `docs.signalscout.run`.

## Notes

The site is deployed as its own Vercel project with `site` as its root, as
the landing page is with `landing`.

**Do not release to `main` before `docs.signalscout.run` answers.** Since
US-344 the README and five repository pages link to it, and `main` is what a
visitor reads on GitHub. The domain needs the Vercel project and a CNAME at
Namecheap, both the owner's.

Creating the Vercel project through the plugin was refused on 2026-09-23: the
session's token can read the team `hariths-projects-04177944` and not write
to it.

## Log

- 2026-09-23T10:50+08:00 — Written from the owner's decisions: audience,
  VitePress over Starlight so a page is the file an agent reads, and split
  and trim so no path in code moves.
- 2026-09-23T11:02+08:00 — Skeleton builds: the home page, one real page with a
  diagram, `llms.txt` and `llms-full.txt`. Two traps. `.vp-doc p` gives a
  Mermaid label the page's line height and cuts its last line;
  `.vitepress/theme/brand.css` resets it. And a preview server started before
  a rebuild serves the old chunks, so a diagram renders empty: restart the
  preview after every build.
- 2026-09-23T12:20+08:00 — The owner corrected the triage advice: "cheaper than scoring" is
  not enough; a triage model must be cheap *and* reliable at its one
  question, or the stage is off. A cheap model that drops real leads saves
  money by losing the product, and no screen shows it. The rule is now said
  that way on the site's models and costs pages, in both example env files
  (so the configuration reference shows it), in `docs/costs.md`, which also
  names the triage loop that proves a candidate reliable, and in the README.
