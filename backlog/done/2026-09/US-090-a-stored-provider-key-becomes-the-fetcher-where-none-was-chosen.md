---
id: US-090
title: A stored provider key becomes the fetcher where none was chosen
type: feature
priority: p2
created: 2026-09-09T17:56+08:00
resolution: shipped
---

## Context

**Connecting a provider does not connect its platforms.** A person saves a key
on the connections screen and the provider card turns green, but every platform
that key unlocks stays as it was: a platform with no key at all still says
nothing can collect it, and a platform whose second provider just arrived asks
the person to choose one. The screen made them paste a key and then made them
answer again for the same account.

**A key stored here is a choice, made where it is pasted.** The platform rows
exist for the deployment holding two keys, where a poll must not pick between
them. But when the saved key is the *only* provider that can fetch a platform,
there is no second answer to pick, and recording it is what the paste already
said. So the save route records the saved provider for every platform that had
no recorded choice and that this one key alone can now fetch.

**Two limits keep a stored key from deciding who pays, and both are
`decideProvider`'s own rules.** A platform another provider is already fetching
is left alone: that provider may be running monitors, and taking it over would
spend money at an account the person did not pick — the exact bill US-026
exists to prevent. If the new key makes two providers able to run, the platform
still asks, as it does today. And a platform that already has a recorded choice
is somebody's decision, which a new key must not override. So the rule is
narrow: record the saved provider only where it becomes the platform's sole
connected provider.

**On an instance taking registrations the rule does not run at all.** A stored
key belongs to one account, while `source_providers` is shared by every account
— BUG-010 is the open ticket for that. Writing a shared row from one tenant's
key would decide for tenants that never saw it, so auto-selection happens only
where signup is closed, which is the single-account instance and the common
deployment. This is US-081's reasoning applied to the choice table instead of
the key table.

## Acceptance

- [x] Saving a provider key records that provider for every platform it can
      fetch that has no recorded choice and no other connected provider.
- [x] A platform another connected provider already fetches is not reassigned;
      when the new key makes two able to run it still asks.
- [x] A platform with a recorded choice keeps it.
- [x] The rule does not write `source_providers` where signup is open.
- [x] The screen shows the recorded choices in the same response that saves the
      key, so no reload is needed to see them.

## Notes

The save route answers with the whole connections screen now, not the single
provider, for the same reason the platform choice route already does: a stored
key changes what the platforms below it are allowed to do, and a reply carrying
one refreshed provider beside stale rows would show the old answer. Onboarding
reads the same route and takes the whole screen back the same way.

The rule lives in `apps/api/src/connections.ts`, beside the other two writers
of `source_providers`. The web screen only renders what the route answers.

## Log

- 2026-09-09T17:56+08:00 — Written.
- 2026-09-09T18:05+08:00 — Done. The rule lives in the save route,
  `PUT /api/connections/:provider`, in `recordChoiceForUnassigned`: after a key
  the provider accepted is stored, each platform the provider can fetch that has
  no recorded choice and now has it as its *only* connected provider gets the
  choice recorded. Both limits are `decideProvider`'s — a platform another
  provider is already fetching keeps it, and a recorded choice is never
  overridden — and on an instance with signup open the whole rule is skipped,
  because a tenant key must not write the shared `source_providers` table that
  BUG-010 owns.

  **The save answers with the whole screen, and so does the delete.** A stored
  key changes what the platform rows below the cards are allowed to do, so a
  reply carrying one refreshed provider beside stale rows would show the old
  answer — the reason the platform choice route already returned the whole
  view. Onboarding takes the same whole screen back, which is what re-decides
  whether the account still needs a key.

  Nine new cases cover it. Four in `connections.test.ts` (records the sole
  fetcher; does not take a running platform; never overrides a recorded choice;
  writes nothing where signup is open), one web case proving the save's reply
  redraws the platform rows, and the existing save and delete web and API cases
  updated to the whole-screen answer. The whole suite passes: 1,625 tests in 94
  files, and lint and typecheck are clean. The App.test.tsx line in the diff is
  a formatter fix for drift that predates this ticket.
