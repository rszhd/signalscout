---
id: US-112
title: The landing page fits a phone
type: feature
priority: p2
created: 2026-09-10T20:05+08:00
completed: 2026-09-10T21:45+08:00
area: landing
resolution: shipped
---

## Context

The landing page was measured on a phone for the first time. At a 375px
viewport it was **9,769px tall** — about twelve screens — and **fifteen of its
links and buttons were under 44px** in one dimension, most of them 23px, which
is the height of their own text.

Length is the harder half, and the page earned it by saying several things
twice. The six platforms are named three times: the strip under the hero, the
first feature card, and the providers section. The first feature card also
repeats the interactive demo directly above it — the same illustrative quote,
the same score — and ends with a link back up to it. The header carries a
four-link nav that wraps onto its own row on a phone, where it repeats the
order that scrolling already gives.

So the rule for this ticket is: **hide only what the page says elsewhere.**
Every element removed below repeats copy that stays on the page, or carries no
words at all. A phone reader loses no sentence, and neither does a mobile
crawler — which matters, because mobile-first indexing renders at this width.

Nothing was removed from the desktop layout. The whole change is two media
blocks at `max-width: 700px`.

## Acceptance

- [x] The header nav is hidden on a phone; the wordmark and the main action stay.
- [x] The decorative question mark, the decoy note and the label under the hero deck are hidden on a phone.
- [x] The first feature card keeps its heading and its sentence and drops the platform list, the repeated match and the back-link.
- [x] The closing section shows three of its five decorative lines.
- [x] Every data provider row on a phone has the same shape: the name, then
      the platforms it fetches on the line below.
- [x] The footer on a phone is the wordmark and three brand marks, in one row
      76px tall, each mark a 44px target.
- [x] Every footer link keeps its own accessible name at every width.
- [x] Every link, button and summary is at least 44px in both dimensions at 320, 360, 390 and 430px.
- [x] No horizontal overflow at 320, 360, 390, 430 or 700px.
- [x] Nothing hidden on a phone is the only copy of itself on the page.
- [x] The desktop and tablet layouts are unchanged: no rule outside the two 700px blocks moved.
- [x] `npm run check` and `npm run build` pass.

## Notes

- The rotation controls stay. Rotation must be pausable, and that is the
  control that pauses it.
- `landing.css` owns the page rules and `features.css` owns the feature card,
  which is the split the two files already had.
- The landing folder is outside the pnpm workspace, so it has no test file and
  `lint:css` does not reach it. The evidence here is measurement, not a suite.
- **A pre-existing overflow was found and left alone.** At 1024px the rotated
  question mark reaches 8px past the document, so a tablet in landscape scrolls
  sideways. It is desktop CSS and outside this ticket. The fix is one
  declaration — `overflow-x: clip` on `body`, or moving the glyph in from
  `right: 0`.
- **A stale price was found beside this work and corrected.** The landing page
  says $20 and its README said $15. $20 is the live price, and BUG-014 already
  moved the application's own screen off a literal onto what Stripe holds. The
  README, `docs/billing.md`, this file's AGENTS.md paragraph and US-072's
  Context all said $15 and now say $20. The page itself needed no edit.

## Log

- 2026-09-10T20:05+08:00 — Measured the page in headless Chrome at 375px:
  9,769px tall, 15 controls under 44px, no horizontal overflow. Section
  heights: features 1,982, providers 1,432, inbox 1,397, hero 1,270, pricing
  1,239.
- 2026-09-10T20:20+08:00 — Added the two 700px blocks. Re-measured: **9,080px,
  a 689px cut**, and **one control under 44px** — the footer's one-letter X
  link, 34px wide, which a `min-width` then fixed.
- 2026-09-10T20:30+08:00 — Swept 320, 360, 390, 430, 700, 768 and 1024px. No
  overflow and no control under 44px at any phone width. Found the 1024px
  question-mark overflow, which predates this change. Check and build pass.
- 2026-09-10T20:45+08:00 — Corrected the cloud price to $20 in four documents,
  on the owner's word. The figure is Stripe's and every copy of it here is a
  copy that can go stale, which is BUG-014's finding; each corrected sentence
  now names Stripe as the source.
- 2026-09-10T21:00+08:00 — The owner read section 04 on a phone and said it
  looked wrong. It did: `space-between` holds a provider's name and its
  platforms apart, and on a phone the right-hand side is a single chip, so the
  gap was wide and a different width on every row. SocialCrawl has five
  platforms, so its chips wrapped under its own name and sat left while the
  four rows around it sat hard right. The platforms now take their own line on
  every row. The section grew 48px and the rows are even: 73, 80, 109, 80, 80.
  The AI list was left alone — its right-hand column is a sentence, so those
  rows were already even. Phone height is 9,128px, still 641px under where it
  started.
- 2026-09-10T21:15+08:00 — The owner said the footer needed fixing, and it did.
  A wordmark and three links do not fit one phone row, so flex shrank them
  rather than wrapping them — and `body` carries `overflow-wrap: anywhere` for
  long URLs, so the labels broke inside their own words. **"LinkedIn" rendered
  as "LinkedI" over "n"**, and a two-line label left its arrow stranded at the
  far right. The same squeeze broke the wordmark itself between 441 and 560px,
  which no phone width would have shown.

  The footer stacks now: the wordmark, then one link per row, left-aligned with
  the rest of the page. `white-space: nowrap` on both is the guard — these are
  names, and `overflow-wrap: anywhere` is right for a URL and wrong for a name.
  The `max-width: 440px` footer rule was deleted rather than left, because the
  700px block now covers it.

  Swept ten widths from 320 to 1280. **From 320 to 700: no overflow, no tap
  target under 44px, and nothing wrapped.** 768, 1024 and 1280 return the same
  numbers they returned before any of this work, so the desktop did not move.
  A phone is 9,219px, which is 550px under where it started.
- 2026-09-10T21:30+08:00 — The owner asked for the footer to be the logo alone
  and kept short, so the links are hidden rather than stacked. **The footer is
  76px on a phone against the 264px stacking cost and the 95px it was before
  any of this.** The word-breaking is moot once the links are gone, and
  `white-space: nowrap` stays on the wordmark, which is the half that broke
  between 441 and 560px.

  **What a phone loses: the X and LinkedIn profile links, which appear nowhere
  else on the page.** The repository does not go with them — the hero's
  "Self-host it" and the last feature card's "Read the source" both reach it.
  A phone is 9,197px, 572px under where it started.
- 2026-09-10T21:45+08:00 — The owner meant the social links should stay, as
  marks rather than words. Each footer link now carries its brand mark — X and
  LinkedIn from `public/brands/`, GitHub from `Icon.astro`, which has the mark
  and the brands folder does not. **The mark is a phone-only affordance**: it
  is `display: none` in the base rule, so a desktop shows the words it has room
  for and never both.

  **The label is hidden from sight and kept in the DOM**, clipped the way
  `monitor-setup.css` already does it. So each link keeps its own accessible
  name — measured as "X", "LinkedIn" and "Open source on GitHub" at every width
  — and no `aria-label` repeats what the link already says. An `aria-label`
  would have been a second copy of the name, wrong the day somebody edits one.

  Three 44×44 marks in a 76px footer, and the page height did not move: the
  marks cost nothing over the wordmark-alone version. 768 and 1024 return the
  footer they always returned, 95px with 34×23, 81×23 and 185×23 links.
