---
id: US-095
title: The logo travels with the email
type: feature
priority: p3
created: 2026-09-10T00:36+08:00
parent: US-094
area:
resolution:
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
outright, so `favicon.svg` is not the source even though it is the sharper
asset.

**The asset has to live in `packages/core`.** `apps/web/public/logo.png` is the
mark, and the worker that sends a digest is a container that may not have the
web app in it at all. A copy inside the sending package is the only version
that is certainly present when the mail is built.

**It is 512×512 and 20 KB, which is too big for a 27-pixel header.** It wants
resizing to about 108 pixels for a 54-pixel display at 2×. Every digest carries
the bytes, so this is a per-message cost and not a one-off.

**Images are off by default in more clients than people expect.** The wordmark
text stays beside the mark, or the `alt` carries it — a header that renders as
an empty box says nothing about who sent the message.

## Acceptance

- [ ] The mark is attached to the message by content id, not linked, not a
      data URI and not inline SVG
- [ ] The asset lives in `packages/core`, so the worker container has it
      without the web app
- [ ] It is resized for a mail header rather than shipped at 512×512, and the
      per-message byte cost is written down
- [ ] A client with images off still shows who sent the message
- [ ] The digest, the immediate alert and the verification email all get it,
      because they share one shell
- [ ] A live send, read in a real client with images on and with images off

## Notes

- `email-theme.ts` holds the shell, so this is one change there plus the
  attachment in `transport.ts`. The transport's `email` signature would gain
  the attachment, or the shell would declare what it needs.
- `apps/web/public/favicon.svg` is the same mark as vector and is the better
  source to resize *from*, if the copy is generated rather than downscaled from
  the PNG.
- Do not let this become a reason to add a remote image later. The objection in
  US-094 stands for anything fetched at read time.

## Log

- 2026-09-10T00:36+08:00 — Written when the owner saw US-094's first dressed
  emails and said the logo was missing. Deferred by them in the same message,
  so this is the record rather than the work.
