---
id: US-379
title: The code is fair source, under the FSL
type: feature
priority: p1
created: 2026-09-23T18:02+08:00
parent:
area: product
resolution:
---

## Context

US-019 chose Apache-2.0: the moat is convenience, so a license that stops a
hosted copy protects nothing, and AGPL shuts out companies that ban it. The
owner has changed the goal. The source stays public so anyone can self-host,
but the software itself is not for sale by anybody else.

The owner's rule, 2026-09-23:

- **Allowed:** self-hosting and use by anyone, businesses included; changing
  the code and running the changed copy; an agency running its own instance to
  find leads for its clients and delivering the results.
- **Refused:** selling the code or a changed copy; selling it as a hosted
  service; an agency giving its clients a login to its instance.
- **Accepted as the price of a standard text:** a product that does not
  compete may be built on the code, and each version becomes Apache-2.0 two
  years after it is released.

**FSL-1.1-ALv2 fits, and a custom text would not be worth its cost.** Its
*Competing Use* is "making the Software available to others in a commercial
product or service" that substitutes for it or offers substantially similar
functionality. Internal use is a named *Permitted Purpose*, and an agency
that delivers leads makes nothing available. Sentry, GitButler, Typebot,
Liquibase and Chartbrew use it, so a reader has met it before. The
Sustainable Use License was the other candidate. It allows only internal
use, which does not clearly cover the agency, and adapting it means a lawyer
and a license nobody has read. AGPL lets anybody sell a hosted copy who
publishes the changes.

**The owner holds every line.** On 2026-09-23 the history had 574 commits,
all the owner's, so no contributor is asked. That stays true only while no
outside patch is merged: a contribution would reach the owner under the
FSL, whose terms refuse a paid hosted service, and the cloud is one. The
owner takes no outside contributions.

**Released code stays Apache-2.0.** v0.14.0 and every earlier tag, and the
npm packages already published, keep the license they shipped with. The FSL
starts at the next release, so this lands before it.

## Acceptance

- [ ] `LICENSE` is the FSL-1.1-ALv2 template, with the owner and 2026 filled
      in.
- [ ] The `license` field is `FSL-1.1-ALv2` in the root `package.json` and in
      `engine`, `pipeline` and `ui`, and `pnpm check:licenses` still passes.
- [ ] Each of the three npm packages ships the `LICENSE` text, and the runtime
      image carries it. Today neither ships any license text.
- [ ] The README's license section says what the FSL allows and refuses in
      the owner's words above, names v0.14.0 as the last Apache-2.0 release,
      and links to this ticket instead of US-019.
- [ ] No page in this repository calls SignalScout "open source". It is "fair
      source": the README tagline, `Login.tsx`'s footer, the site footer in
      `site/.vitepress/config.mts`, PLAN.md, and the package READMEs. A
      mention of somebody else's open-source software stays.
- [ ] CONTRIBUTING.md says pull requests are not accepted, and says where a
      bug report, a question and a security report still go.
- [ ] AI_POLICY.md, AGENTS.md, `backlog/README.md` and the DCO step in
      `ci.yml` agree with no outside contributions.
- [ ] US-313, US-314 and US-315 are dropped, each with a Log line naming this
      ticket: each one exists to bring an outside contributor in.
- [ ] CHANGELOG.md names the license change in the next release's entry.

## Notes

The template is at <https://fsl.software>. It asks only for the licensor
and the year. The owner may still have a lawyer read it before it ships.

Two decisions are open. Does the owner's own `Signed-off-by` stay, now that
it certifies nothing to an outside reader? Does the GitHub repository
description and topics change here, or by hand? The second is a change to a
public page, so it is the owner's.

The hosted application calls itself open source too, on its landing and
pricing pages. That is a change in the hosted repository, under its own
ticket.

## Log

- 2026-09-23T18:02+08:00 — Written on the owner's decision, after comparing
  Apache-2.0, AGPL-3.0, the Sustainable Use License, PolyForm, the Elastic
  License and the FSL. The FSL definitions above were read from the template
  on getsentry/fsl.software today, and each product named above was checked
  against its own repository's `LICENSE`.
