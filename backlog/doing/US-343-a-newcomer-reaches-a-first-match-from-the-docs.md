---
id: US-343
title: A newcomer reaches a first match from the docs
type: feature
priority: p1
created: 2026-09-23T10:50+08:00
parent: US-342
area: docs
resolution:
---

## Context

Nothing written today walks a person from an empty instance to a match
worth reading. The README sells the product and `docs/self-hosting.md`
installs it; between them sit the four answers, the monitor form, the cost
test, the inbox, a verdict and a draft, and a person learns those by
clicking.

The site's *Getting started* and *Using SignalScout* sections are that
walk, written for somebody who has never seen the product, and true on both
the self-hosted build and the cloud where they agree.

## Acceptance

- [x] *Getting started*: what SignalScout does and does not do, and the
      first project, first monitor and first match, in that order.
- [x] *Using SignalScout*: projects, monitors, the inbox, verdicts, reply
      drafts, notifications, CSV export, each one page.
- [ ] Every screen name and button label on a page matches the application.
- [ ] Where the cloud differs, the page says so in one line and links to the
      cloud section.
- [ ] Every page has a screenshot or a diagram where one is clearer than a
      paragraph.
- [ ] A committed script takes every screenshot from a local instance seeded
      with invented projects, posts and handles, and re-running it replaces
      them all.
- [ ] The README's `docs/img/inbox.jpg`, which shows a real Reddit user's
      handle and post, is replaced by one the script takes.

## Notes

A screenshot is stored beside its page. `site/README.md` holds the rules.

## Log

- 2026-09-23T10:50+08:00 — Written as part of the site split, US-342.
- 2026-09-23T11:17+08:00 — Screenshots wait for the owner: the UI is being polished first, and a
  screenshot of the screen before the polish is one to take twice. No seed
  data and no screenshot script yet.
- 2026-09-23T11:24+08:00 — The text and diagrams of both sections, each label read from the
  screen's source. A screenshot's place is an HTML comment,
  `<!-- screenshot: … -->`, which a reader does not see and the script will
  find. One claim written earlier was wrong and is fixed: a verdict does not
  change how the next post is scored; nothing in scoring reads it.
