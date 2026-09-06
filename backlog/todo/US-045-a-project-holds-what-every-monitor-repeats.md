---
id: US-045
title: A project holds what every monitor repeats
type: feature
priority: p2
created: 2026-09-06T13:42+08:00
parent:
area:
resolution:
---

## Context

**A person with three monitors has typed the same three answers three times.**
The product, the ideal customer and the problem describe a *business*, not a
search. Only the queries, the platforms and the schedule differ between a
monitor watching Reddit for a keyword and one watching TikTok for another — and
today the form asks for all seven every time.

That is friction on the path this product most wants people to take: making a
second monitor. It is also how the answers drift. Somebody typing their ideal
customer for the third time writes it slightly differently, and
`monitors.version` records that as an edit, so two monitors are now judged
against two subtly different descriptions of the same business and their
verdicts cannot be compared.

**And there is no grouping.** The monitor list is a flat list. A person running
one business sees one list and that is fine; a person running two sees them
interleaved with no way to say which belongs to what.

**The hard part is what happens when a project's answers change**, and it
should be decided rather than discovered.

`monitors.version` counts edits to exactly the four fields `ai/prompt.ts` puts
in the system prompt, and US-012 stores every verdict against the version that
earned it. That is what makes feedback mean anything. If those four fields move
to a project, then editing a project moves the version of **every monitor under
it at once** — which is correct, and much larger than any edit a person can make
today. The screen has to say so before they press it, and the number of affected
monitors is the sentence to show.

The alternative — a project holds *defaults* that are copied into a monitor at
creation and never linked again — has none of that risk and none of the benefit
either. A person who improves their problem statement would have to edit every
monitor by hand, which is the thing this ticket exists to remove. **Copy is the
smaller feature and link is the useful one; pick deliberately and say which in
the Log.**

**What it must not become.** PLAN.md's NOT list has *CRM platform* on it, and a
project that grows members, permissions and stages is one. A project is a name
and four answers. It is not a workspace, and this instance has one account until
[US-017](US-017-a-self-hosted-instance-has-one-account.md) says otherwise.

## Acceptance

- [ ] A person can create a project with a name and the four answers the
      classifier reads: product, ideal customer, problem, signals
- [ ] Creating a monitor inside a project prefills those four, and the person
      can still change them for that monitor
- [ ] The monitor list groups by project, and a monitor without one still
      appears rather than disappearing into a group nobody made
- [ ] Whether a project's answers are copied or linked is decided in the Log,
      with the reason, and the version rule follows from it
- [ ] If they are linked: editing a project says how many monitors it will
      re-version **before** it is saved, because a verdict is recorded against
      the version that earned it
- [ ] Every monitor that exists keeps working with no project, in a migration
      that needs no answer from anybody
- [ ] `monitors.version` still counts only the four fields. A rename, a moved
      threshold or a changed schedule must not move it, whether it happens on a
      monitor or on a project

## Notes

- The four fields are named in `ai/prompt.ts`'s `MonitorProfile` and nowhere
  else. Read it before moving them: the version rule in AGENTS.md is written
  against exactly that list.
- `queries`, `subreddits`, `sources`, `minScore`, the schedule, the budget and
  the pre-filter settings all stay on the monitor. They describe a search, not
  a business.
- US-010's query generator takes the four answers, so a project makes "generate
  a plan for another platform" a one-screen job rather than a re-typing job.
  That is probably this ticket's largest quiet win.
- A project is also the natural home for a default budget and a default
  schedule later. Do not add either now — the ticket is about the answers, and
  a project that starts collecting settings ends up a workspace.

## Log

- 2026-09-06T13:42+08:00 — Written at the owner's request. The decision the
  ticket refuses to make for the implementer is copy against link, because it is
  the difference between removing some typing and changing what a verdict is
  recorded against.
