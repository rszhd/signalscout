---
id: US-019
title: The project has a license
type: chore
priority: p2
created: 2026-09-04T23:00+08:00
parent:
area:
resolution:
---

## Context

There is no LICENSE file. Without one the default is exclusive copyright: legally
nobody may use, copy, modify or redistribute this code, which is the opposite of
what PLAN.md promises on its first page.

Nothing is blocked today, because the repository is private and the only author
is the owner. Two things change that, and the second is the one that matters.

**Going public.** A repository with no license contradicts its own README.

**The first outside contribution.** Adding or changing a license after other
people have committed needs the agreement of every one of them. A decision that
costs one commit today costs a search for past contributors later, and some of
them will not answer.

So this is cheap now and expensive soon. That is the whole reason it is written
down rather than left as a note in the README.

### The trade, stated honestly

Three candidates. The argument between them is not about openness; all three are
open-source licenses.

**MIT** — shortest, most permissive, most adopted. Maximum adoption, no patent
grant.

**Apache-2.0** — permissive like MIT, plus an express patent grant and a clear
contribution clause. Slightly longer. Many companies prefer it for exactly the
patent term.

**AGPL-3.0** — copyleft with a network clause: anyone offering the software as a
service must publish their changes. The usual defensive choice for a project
with a hosted tier.

Two facts specific to this product cut against AGPL, and they should be weighed
before the usual reflex wins.

**The moat is convenience, not code.** PLAN.md is explicit that the hosted
version does not charge for features the open-source build lacks. It charges
$5 because someone would rather not run a server. A license cannot protect a
moat that is not made of code, and a competitor who forks and hosts it under
AGPL simply publishes their changes and competes anyway.

**The users are companies self-hosting.** Many organisations ban AGPL software
outright by policy, regardless of whether the network clause would ever be
triggered by internal use. For a product whose whole distribution strategy is
self-hosting inside companies, that policy ban is a direct cost to adoption, and
it is paid by the exact people PLAN.md wants running the tool.

### Contribution terms are part of this decision

PLAN.md invites community connectors, so the terms under which they arrive have
to be settled at the same time:

- **DCO** — a signed-off-by line. Light, standard, no paperwork.
- **CLA** — contributors assign or license rights to the owner. Gives freedom to
  relicense later, and deters contributors, especially for a small project.
- **Neither** — contributions are taken under the project's license by
  implication. Common, and weaker if the license is ever revisited.

## Acceptance

- [ ] A LICENSE file at the repository root holds the full, unmodified text of
      the chosen license
- [ ] The README's license section states the license and links to the file
- [ ] `package.json` carries a matching `license` field when it exists
- [ ] Contribution terms are decided — DCO, CLA or neither — and stated in
      `CONTRIBUTING.md`
- [ ] The licenses of the dependencies in STACK.md are checked as compatible
      with the choice, and the check is a command that can be re-run
- [ ] The decision and the reason are recorded in this ticket's Log, so the
      argument is not had a second time
- [ ] No per-file license header is added unless the chosen license requires one

## Notes

- Becomes p1 before this repository is made public, and it must land before the
  first outside contribution is merged, not after.
- README.md, *License*, holds the short version of this trade today.
- PLAN.md, *Cloud version*, is the source of the claim that the moat is
  convenience rather than code. If that changes, this decision changes with it.
- A dependency licence check is cheap and belongs in CI once there are
  dependencies. It is one line with a tool such as `license-checker`.

**Recommendation for the maintainer, which is not a decision.** Apache-2.0.
The moat is convenience by design, so copyleft defends nothing that is actually
at risk; the express patent grant is worth more than MIT's brevity to the
companies expected to self-host; and it does not trip the corporate policy bans
that would cost adoption among exactly those users. AGPL is the right answer for
a project whose hosted tier competes on features. This one does not.

Pair it with DCO rather than a CLA. A CLA buys the freedom to relicense, and
this ticket exists to make relicensing unnecessary.

## Log

- 2026-09-04T23:00+08:00 — Written after the README shipped with the license deliberately
  undecided. Left open rather than picked quietly, because the choice has money
  attached and belongs to the owner.
