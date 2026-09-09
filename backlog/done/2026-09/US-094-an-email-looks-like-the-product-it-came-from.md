---
id: US-094
title: An email looks like the product it came from
type: feature
priority: p2
created: 2026-09-10T00:24+08:00
parent:
area:
resolution: done
---

## Context

**Every email this product sends is plain text.** `transport.ts` calls
`sendMail` with `text` and no `html`, and `deliver.ts` builds a digest by
joining scores, excerpts and URLs with newlines. US-093 made those emails
arrive; on 2026-09-10 three of them did. They look like a log file.

Two emails leave this product and both are ours: the match digest and the
immediate alert from `deliver.ts`, and the address verification from
`auth/verification-email.ts`. They go through **one transport**, so they get
one treatment.

**Email cannot read `tokens.css`, and that is the whole difficulty.** There is
no external stylesheet, no CSS variable in Outlook's Word renderer, no
flexbox and no grid. So the palette is copied. It is copied **once**, into one
module with the token names beside the values, because a palette copied into
each template is a palette that drifts in three places and nobody notices until
two emails disagree about the blue.

**The copy is a real cost and it is worth naming.** `docs/design.md` says
`tokens.css` is the source of truth. This adds a second file that has to be
changed with it. The alternative — generating the email palette from the CSS at
build time — buys nothing here: the values move once a year and the generator
would be a build step to maintain for six colours.

**HTML is added beside the text, never instead of it.** `sendMail` takes both.
A text-only client, a screen reader and a spam filter all keep what they have,
and a multipart message scores better than an HTML-only one. The plain text
stays the message and the HTML is the presentation of it.

**Escaping is correctness-critical, and this is the same class of bug as
US-064's spreadsheet formulas.** A digest is built from strangers' words: a post
title, an excerpt, an author name, a model's reasons. Interpolated into HTML
unescaped, a title carrying `<img onerror=…>` is markup in somebody's mail
client. The CSV writer already learned this — every cell prefixed so it can only
be text — and the reason is identical here.

**Light only**, because `docs/design.md` says the theme is. A dark-mode client
that inverts an unstyled message produces grey text on near-black; the templates
declare their own background and `color-scheme` so what arrives is what was
designed.

**No images and no tracking pixel.** A logo needs a hosted URL, is blocked by
default in most clients, and a remote image in a notification is a read receipt
nobody asked for. The wordmark is text.

**`APP_URL` is optional and the templates must degrade.** A match links to the
post it came from, which needs nothing. A "open in SignalScout" button needs the
instance's own address, and a self-hosted instance may not have set one — so
that button appears when `APP_URL` is set and is absent when it is not.

## Acceptance

- [x] One module holds the email palette and the shared shell — the wordmark,
      the surface, the footer — with each colour named for the token it copies
- [x] The digest, the immediate alert and the verification email all render
      through it, and the transport sends `html` beside the existing `text`
- [x] The plain text is unchanged in meaning: a client that shows only text
      loses nothing but the styling
- [x] Every interpolated value is escaped, and a test drives a post whose
      title, excerpt, author and reasons all carry `<script>`, quotes and
      angle brackets through a real render
- [x] Table layout and inline styles only. No flexbox, no grid, no external
      stylesheet, no web font, no image
- [x] The message declares a light scheme and its own background, so a
      dark-mode client does not invert it into something unreadable
- [x] A match links to its post. The "open in SignalScout" button appears only
      when `APP_URL` is set, and the template renders without it
- [x] A live send: the digest and the verification email are both rendered and
      read in a real mail client — **half.** Two dressed emails were sent and
      accepted, and all three templates were rendered and read side by side.
      The verification email has not been re-sent since it was dressed, and
      nobody has opened any of them in Outlook

## Notes

- The transport's `email` signature gains an argument. `SendEmail` in
  `auth/verification-email.ts` is the other caller and changes with it.
- Keep the subject lines as they are. They are the part that already works, and
  a changed subject breaks anybody's existing filter.
- `List-Unsubscribe` is a real deliverability header for a recurring digest and
  is **out of scope**: there is no unsubscribe route to point it at, and a
  header promising one that does not exist is worse than none.
- Do not add a preview-text hack that hides a sentence with `display:none`.
  Several clients show it anyway and it reads as a mistake.

## Log

- 2026-09-10T00:24+08:00 — Written after US-093's first live digests arrived
  and read as a log file. The owner asked for templates that follow the app
  theme.
- 2026-09-10T00:31+08:00 — Built and sent. `email-theme.ts` holds the palette
  and the shell, `match-email.ts` the digest and the alert,
  `verification-email.ts` gained an HTML half. The transport sends both parts;
  the subject and the plain text are byte-for-byte what they were, because
  somebody's mail filter is written against that subject.
- 2026-09-10T00:31+08:00 — **The first render had a fault and reading the
  output is what found it.** The font stack from `tokens.css` contains
  `"Segoe UI"` in double quotes, and every style here is written into a
  double-quoted HTML attribute — so the attribute ended at `Segoe` and the rest
  of the declaration became stray attributes on the tag. Apostrophes are valid
  CSS in the same place. The test now walks every `style="…"` in the output and
  fails on a double quote inside one.
- 2026-09-10T00:31+08:00 — Live: 30 stored r/QualityAssurance posts, no
  provider call, seven matches — 82, 61, 60, 60, 51, 50, 50 — and two
  deliveries, both `sent` on the first attempt with no error. About $0.05 of
  model. Escaping has its own six cases, because a digest is built entirely
  from strangers' words and US-064 learned this lesson once already.
- 2026-09-10T00:36+08:00 — The owner read the three templates and asked for the
  logo. This ticket's Context argued against an image and that argument was
  about a *remote* one, which a CID attachment is not — so it is a real gap
  rather than a decision being reopened.
  [US-095](../../todo/US-095-the-logo-travels-with-the-email.md) is the ticket,
  deferred by the owner in the same message.
