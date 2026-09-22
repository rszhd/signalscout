---
id: US-294
title: The repository has a door
type: chore
priority: p2
created: 2026-09-22T16:02+08:00
parent:
area: docs
resolution:
---

## Context

No issue has ever been opened by anyone but the owner. No fork. Discussions
are off. There is no issue template, no SECURITY.md, no code of conduct.

Postiz grew on people asking questions in public and getting answered. A
repository with no place to ask does not get the question; it gets a
silent close of the tab. And this application stores keys that spend money,
so the first serious user will look for a security contact before they
trust it with one.

A Discord is the Postiz answer. It is not this ticket: an empty Discord is
worse than none. Discussions is the same door with no cost when it is quiet.

## Acceptance

- [ ] GitHub Discussions is enabled with three categories: Q&A, Ideas, Show
      and tell.
- [ ] `.github/ISSUE_TEMPLATE/` holds two YAML issue forms, not markdown
      templates: a bug report (expected, happened, reproduce, and the "what
      did you measure vs infer" line CONTRIBUTING.md already asks for) and a
      feature request (what, why you need it, how you would do it — a source
      request is a feature request whose "what" names a platform and a
      provider). Each form applies its `type:` label.
- [ ] The chooser (`config.yml`) sends three things away from Issues:
      questions to Discussions, install trouble to Discussions Q&A, and
      security to GitHub Security Advisories. Blank issues stay allowed.
- [ ] Labels exist in two groups, made with `gh label create`: kind —
      `type: bug`, `type: feature`, `type: install`, `type: support`; and
      difficulty — `good first issue`, `easy`, `medium`. The `ticket` label
      US-299 uses is made here too.
- [ ] `.github/PULL_REQUEST_TEMPLATE.md` asks three things: what changed and
      where, why, and how it was tested. It repeats the DCO line and the
      commit-message rule from CONTRIBUTING.md.
- [ ] `SECURITY.md` names a private contact, the supported version (latest
      tag), and what is in scope: the app, the two packages, the image.
- [ ] `CODE_OF_CONDUCT.md` exists. Contributor Covenant, unmodified, is
      enough.
- [ ] README.md's Contributing section links Discussions for questions and
      the forms for reports.
- [ ] CONTRIBUTING.md's *Reporting something* says how a request travels:
      it arrives as an issue; when it is agreed it becomes a ticket file
      whose Notes names the issue; the issue gets a comment with the ticket
      link and stays open until the file reaches `done/` (US-299 closes it).
      An issue nobody agreed to is closed with a sentence, not left to a bot.

## Notes

- Discussions is a repository setting: `gh api -X PATCH repos/rszhd/signalscout -f has_discussions=true`.
- Postiz's forms are the model: `gitroomhq/postiz-app/.github/ISSUE_TEMPLATE/`.
  Their chooser sends install trouble to Discord; ours sends it to
  Discussions until there is a Discord.
- Revisit Discord when ten people have posted in Discussions in a month.
  Record the count here when that day comes.

## Log

- 2026-09-22T16:02+08:00 — Written from a gap review against the Postiz playbook.
- 2026-09-22T16:30+08:00 — Grew after reading Postiz's tracker: YAML forms, a chooser, two label groups, a PR template, and the intake rule. The mirror itself is US-299.
