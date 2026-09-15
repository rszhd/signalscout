---
id: US-143
title: Managed keys hide provider and model plumbing
type: feature
priority: p1
created: 2026-09-15T20:40+08:00
parent: US-141
area: web
resolution: shipped
---

## Context

**An account using this instance's keys has made one decision, and the screens
keep asking it six more questions.** The connections screen still lists every
provider account and every provider choice. The account navigation still offers
Providers and Models. None of those names help somebody whose plan includes
the data and model access, and together they make “nothing to set up” read as a
setup job.

The mode is still the account's to change. `/connections` is therefore the one
address that remains visible in both modes, but it leads with the product
choice: managed by SignalScout, or the account's own keys. Provider accounts,
provider comparisons, model keys and model choices appear only after the person
chooses the second path.

**Hiding a link is not hiding a route.** A bookmark and a typed address still
reach `/providers` and `/models`, so the router sends a managed-keys account
back to `/connections`. An unanswered key-source read hides nothing; a failed
request is not evidence that the account may not manage its own keys.

The switch must not be an accidental radio click. Moving to either mode opens a
confirmation that states the consequence, then takes effect on the next
collection. Stored keys are not deleted when the account returns to managed
mode.

## Acceptance

- [x] `/connections` is headed “Data & AI setup” and makes managed versus own
      keys the first question
- [x] On hosted managed keys it shows no provider name, provider account, connection
      count, key field, model name or key-storage detail
- [x] On own keys it keeps every provider account and platform-provider control,
      and links to Models and the Compare providers screen
- [x] Changing either mode requires an explicit confirmation and the reply
      redraws the screen
- [x] Providers and Models are absent from desktop and phone account navigation
      on hosted managed keys, while Data & AI setup remains available
- [x] A direct `/providers` or `/models` address redirects a hosted managed-keys
      account to `/connections`; an own-keys account can still open both
- [x] If the key-source read fails, the account links and routes stay available
- [x] Billing reads `keySource`, calls the mode managed or own keys, and sends
      both modes to “Change how SignalScout runs”
- [x] Existing stored credentials are neither changed nor deleted
- [x] Screen tests drive the choice and route behavior through the DOM
- [x] Web tests, typecheck and production build pass

## Notes

- `useSetup` already reads `/api/connections` before the shell is shown. Reuse
  that answer for navigation and route guards rather than adding another read.
- The backend remains the authority. This change hides irrelevant controls; it
  does not add a second key-source rule or change which credentials a poll uses.
- The detailed provider comparison remains at `/providers`. It is advanced help
  for an account paying provider invoices, not a primary account destination.

## Log

- 2026-09-15T20:40+08:00 — Written after reviewing the UI that followed
  US-141. The owner asked to remove provider, connection-key and model plumbing
  from the managed-keys experience.

- 2026-09-15T20:52+08:00 — Built. Data & AI setup now owns the mode choice and
  asks for confirmation before changing it. Managed hosted accounts see no
  provider or model controls; their navigation and direct routes return to this
  choice. Own-key and self-hosted accounts keep the detailed screens.

  The browser rendered both modes at 1440 by 900 and 375 by 900 with no
  horizontal overflow. The phone confirmation dialog stayed inside the
  viewport. The focused web run passed 146 tests. The full suite passed 2,252
  tests with local Postgres, Docker and loopback access. Lint, typecheck and
  both production builds passed.
