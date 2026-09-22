---
id: US-292
title: The README's first screen shows the product and names the cloud
type: chore
priority: p1
created: 2026-09-22T15:58+08:00
parent:
area: docs
resolution: shipped
---

## Context

The project follows the Postiz pattern: the whole product is open source,
the hosted version sells convenience, and the repository is where people
find it. The README is the front door of that plan, and its first screen is
an essay. There is no picture of the inbox, no install command above the
fold, and the hosted product at signalscout.run is not linked anywhere —
its one mention is a sentence inside the license section.

A GitHub visitor decides in seconds. Postiz's README opens with a
screenshot, then a link to the cloud, then the install. Ours makes the
reader earn the picture, and never tells them there is a version they do
not have to run.

The essay is good and stays. It moves below the fold.

## Acceptance

- [x] The first screen of README.md holds, in this order: one-sentence pitch,
      a screenshot or short GIF of the inbox with real-looking matches, a
      "Try SignalScout Cloud" link to https://www.signalscout.run, and the
      install command.
- [x] The image lives in the repository (`docs/img/`), not on an external host,
      so a fork and an npm README render it.
- [x] The install shown is the one a self-hoster runs (see US-295); until that
      ships, the current three lines.
- [x] The cloud is described in one sentence as the same application with
      no server and no keys to bring — not as a version with more features.
- [x] The existing sections (how it works, keys, costs, providers, what this is
      not, repository table, contributing, license) survive below, unchanged
      except for links.
- [x] `packages/engine/README.md` and `packages/pipeline/README.md` still say
      what they said; this ticket touches the root README only.

## Notes

- Take the screenshot from a real instance at 1280 px wide, in the light
  theme, with a monitor that has at least five matches. A staged fixture is
  fine; a blank inbox is not.
- The cloud's landing already links back to the repository
  (`landing/src/site.ts` in the cloud repo), so this closes the loop.

## Log

- 2026-09-22T15:58+08:00 — Written from a gap review against the Postiz playbook.
- 2026-09-22T17:20+08:00 — Shipped. The first screen is the pitch, `docs/img/inbox.jpg`, the cloud link and the four-line install. The essay follows the rule below it, unchanged. *Running it* lost the repeated code block and kept the TLS warning and the self-hosting link.
- 2026-09-22T17:20+08:00 — The screenshot came from the local dev app at 1568x705, on the SignalScout4 monitor: 44 conversations, the open one scoring 79 with its breakdown and the model's reasons. Two things were changed in the page before the capture, and neither is a product claim: the account email in the sidebar reads `you@example.com` instead of the owner's, and the *Paused* banner is hidden. Every monitor on that machine is paused on purpose, because a poll spends money; the banner is a fact about the machine, not about the product. Replace the image when a running instance can be shown without either edit.
