---
id: US-095
labels: [help wanted, medium]
issue: 46
title: The logo travels with the email
type: feature
priority: p3
created: 2026-09-10T00:36+08:00
parent: US-094
area:
resolution: shipped
---

## Context

**US-094 put a text wordmark at the top of every email and the owner asked for
the real logo.** It was deferred on 2026-09-10, not refused: the templates
shipped without it and this ticket is where it comes back.

US-094's Context argued against an image, and that argument was about a
**remote** one — a hosted URL is blocked by default in most clients and a
remote image in a notification is a read receipt nobody asked for. A logo that
travels *inside* the message meets neither objection.

**So the delivery is a CID attachment**, which is the one form that works. A
`cid:` reference is part of the multipart message: nothing is fetched, nothing
is hosted, and no client is asked to trust a third party. A data URI is
stripped by Gmail and Outlook. An inline `<svg>` is stripped by Gmail
outright, so the canonical `@signalscout/ui/mark.svg` is not sent directly
even though it is the sharper source artwork.

**The source asset lives in `packages/ui`.** US-270 split the old core package
and put the canonical mark there. `apps/web/public/logo.png` is the raster
copy, but the worker that sends a digest is a container that may not have the
web app in it at all. The mail build must read or generate its attachment from
the package rather than reaching into the web app.

**It is 512×512 and 20 KB, which is too big for a 27-pixel header.** It wants
resizing to about 108 pixels for a 54-pixel display at 2×. Every digest carries
the bytes, so this is a per-message cost and not a one-off.

**Images are off by default in more clients than people expect.** The wordmark
text stays beside the mark, or the `alt` carries it — a header that renders as
an empty box says nothing about who sent the message.

## Acceptance

- [x] The mark is attached to the message by content id, not linked, not a
      data URI and not inline SVG
- [x] The asset comes from `packages/ui`, so the worker container has it
      without the web app
- [x] It is resized for a mail header rather than shipped at 512×512, and the
      per-message byte cost is written down
- [x] A client with images off still shows who sent the message
- [x] The digest, the immediate alert and the verification email all get it,
      because they share one shell
- [x] A live send, read in a real client with images on and with images off

## Notes

- `email-theme.ts` holds the shell, so this is one change there plus the
  attachment in `transport.ts`. The transport's `email` signature would gain
  the attachment, or the shell would declare what it needs.
- `packages/ui/src/assets/mark.svg` is the canonical vector and is the better
  source to resize *from*, if the copy is generated rather than downscaled
  from the PNG.
- Do not let this become a reason to add a remote image later. The objection in
  US-094 stands for anything fetched at read time.

## Log

- 2026-09-10T00:36+08:00 — Written when the owner saw US-094's first dressed
  emails and said the logo was missing. Deferred by them in the same message,
  so this is the record rather than the work.
- 2026-09-20T15:06+08:00 — Updated the source path after US-270 moved the
  canonical mark into `packages/ui` and US-272 removed the old radar favicon.
- 2026-09-24T07:18+08:00 — Built with the owner's request to bring the emails
  to the current brand. `email-mark-generate.ts` draws the nine-dot
  `mark.svg` from its circles with Node's own `zlib`, no new dependency, into
  a committed `email-mark.ts`: a 64-pixel PNG of 743 bytes, shown at 32
  pixels as the sidebar shows it. `email-mark.test.ts` fails when the
  committed file no longer matches the SVG. The transport attaches it only
  when the HTML names `cid:signalscout-mark@signalscout`. A message built
  with nodemailer and not sent was `multipart/related` with the PNG `inline`
  under that content id, and weighed 3,269 bytes against 1,715 without the
  mark: about 1.5 KB a message. Headless screenshots with the image and
  without it looked right; no real client has shown it yet.
- 2026-09-24T07:18+08:00 — The hosted repository sends through the same
  transport and gets the mark with the next pipeline release. Its
  `verification-email.test.ts` checks the old accent `#36578f`, which becomes
  `#0b57d0` in the same release.
- 2026-09-24T07:19+08:00 — Sent one verification message through Resend to
  the owner's address, with a "[Test]" subject and the docs site in place of
  a token link. Resend accepted it. Waiting for the owner to read it with
  images on and off.
- 2026-09-24T07:20+08:00 — The owner received the test message and replied that it
  looks good, after being asked to read it with images on and off.
