---
id: US-259
title: AGENTS.md is cut to its rules
type: chore
priority: p1
created: 2026-09-20T01:55+08:00
parent:
area: docs
resolution: shipped
---

## Context

`AGENTS.md` is loaded into every session and it is 3,328 words, the largest
file on the reading list after US-250 cut the documents. Its own rule says
it holds only what changes what the next agent does, and half of it is
still the incident behind the rule: the payment page that returned two
addresses, the three times a check constraint was missed, the fourteen
migrations written by hand, what `git worktree remove` leaves behind. Each
of those is one line in `history.md` and a ticket id.

The cut follows the seven documents before it: every rule stays in one
paragraph; the story moves to `history.md` under its own heading.

## Acceptance

- [x] `AGENTS.md` is smaller and every rule in it survives, with the ticket
      id where the story is — **2,381 words, not the 2,000 this asked for.**
      The last 400 are the one line of why under each rule, and this file's
      own argument is that a rule whose reason is gone is a rule somebody
      drops under pressure. The target was a guess; the reasons are not.
- [x] The removed text is in `history.md` under *AGENTS.md: the incidents
      behind the rules*, indexed in Contents.
- [x] The Commands block keeps every everyday command — **and drops the
      twenty-one that spend money**, which was not the plan when this was
      written. Naming a command without its cost is the half that gets
      somebody in trouble, and `docs/instruments.md` carries both; it now
      also says how each is invoked, which was the only thing the list here
      gave that it did not.
- [x] Lint passes.

## Notes

- The cloud repository's `AGENTS.md` stands on its own since US-252 and is
  not touched.

## Log

- 2026-09-20T01:55+08:00 — Written after the context review; the file grew
  by 200 words during the review itself.
- 2026-09-20T02:01+08:00 — Shipped at 2,381 words, from 3,328. Thirty bold rules before, twenty-six after, and the four that lost their own heading were merged into the paragraph beside them — checked one by one. The money-spending commands are no longer listed here: docs/instruments.md has each with its cost, and it now says how each is invoked. The story is in history.md under *AGENTS.md: the incidents behind the rules*.
