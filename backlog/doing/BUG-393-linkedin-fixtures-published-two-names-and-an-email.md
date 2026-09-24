---
id: BUG-393
title: LinkedIn fixtures published two names and an email address
type: bug
priority: p1
created: 2026-09-24T12:53+08:00
parent:
area: sources
resolution:
---

## Context

**Three committed LinkedIn fixtures held a real person's identity**, found on
2026-09-24 while US-386 built HarvestAPI's capture:

- `apify/linkedin-fixtures/search-by-date.json` and `search-past-week.json`:
  two people's names, "Pramod Dutta" and "Chitra Malode", in post text, and
  ten authors' bare member numbers under `author.urn`.
- `socialcrawl/linkedin-fixtures/search-no-results.json`: two email
  addresses in recruiting posts, one of them a person's work address.

**Why the scrubber missed them.** The Apify capture replaced a mention by its
`start` and `length` in UTF-16 units, where LinkedIn counts code points. On a
post written in styled Unicode letters it replaced the wrong characters and
kept the name. It never looked for a name an author writes into their own
post ("Follow <name> for more"), an email address, or a member number that is
not in the `ACoAA…` form.

**The raw answers are gone.** Apify deletes a run's dataset after a few days,
so the capture's `--rescrub` answers "run not found" for these runs. The
repair works on the committed files instead, keeping every pseudonym already
there so no test's expected value moves.

**The npm packages never held them**: `files` ships `dist` only. **Git history
does**: the files are on `origin/main` and `origin/dev` since `b913fba`.

## Acceptance

- [x] One LinkedIn scrubber, `providers/linkedin-scrubber.mjs`, shared by the
      Apify and HarvestAPI captures, with the code-point, self-name, email and
      member-number fixes
- [x] The three fixtures repaired by `repair-linkedin-fixtures.mjs`, and no
      name, member number or personal address left in any LinkedIn fixture
- [x] Every LinkedIn connector's tests pass unchanged
- [ ] The owner decides whether to rewrite the public history

## Notes

- The SocialCrawl and ScrapeCreators LinkedIn captures keep their own
  scrubbers: their answers have other shapes, and both connectors are off.
  The repair's email rule covers what SocialCrawl's let through.
- Rewriting history means a force-push to `main` and `dev`, which every clone
  and open branch would feel. It is the owner's call.

## Log

- 2026-09-24T12:53+08:00 — Found, repaired and tested. The repair replaced 12
  items in each Apify search file (2 names, 10 member numbers) and the 2
  addresses in the SocialCrawl file; each replacement was read one by one. A
  first version was not safe to run twice — after a replacement the mention
  offsets point at the wrong words — so it now accepts only a span shaped
  like a name, and says to run it once per folder. LinkedIn provider tests:
  11 files, 376 tests pass.
- 2026-09-24T12:55+08:00 — The first commit left the HarvestAPI capture on
  its own copy of the scrubber (restoring its fixtures folder from git undid
  the import) and failed lint on formatting. The follow-up fixes both, and a
  check on a mention after styled Unicode letters replaced the name, the
  address and the member number and kept the letters.
