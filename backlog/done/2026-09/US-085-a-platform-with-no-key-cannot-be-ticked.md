---
id: US-085
title: A platform with no key cannot be ticked
type: feature
priority: p2
created: 2026-09-09T11:05+08:00
parent: US-010
area: web
resolution: done
---

## Context

**Step 3 of the monitor form ticks every platform, including the ones this
account holds no key for.** `/api/monitor-options` answers `ready: false` for
those and the card shows "Not connected", but the box is ticked and the person
walks four more steps — a search plan the model is paid to write, a schedule, a
budget — before the form says the monitor will be saved paused.

The owner has decided the box should be disabled instead. The signal already
exists and is exact: `ready` is `startBlockers` answering for *this account*
since US-067, honouring the recorded provider choice, so a platform is unready
only when no provider that could fetch it has a key.

**One consequence has to be accepted rather than designed around.** A person
with no keys at all can currently write a whole monitor and save it paused.
After this they cannot get past step 3. That is the point of the change — a
monitor that cannot poll is not worth the model call that writes its
queries — but the screen has to say so and offer the way out, which is the
connections page.

**Three rules keep the disabled box from becoming a trap.**

* **Unready platforms are not ticked to begin with.** Disabling a box that is
  already ticked would leave a selection nobody can remove.
* **A ticked platform stays tickable.** The form reads the options once. If a
  key is deleted elsewhere and the options are read again, a platform that is
  already selected must stay enabled so it can be unticked, and the "saved
  paused" notices stay live for exactly that case.
* **The options can be read again without losing the answers.** Somebody who
  leaves to paste a key must be able to come back and continue, not reload the
  form and retype four fields. One button re-reads `/api/monitor-options`.

## Acceptance

- [x] A platform with `ready: false` renders a disabled checkbox and is not
      selected when the form loads.
- [x] A platform with `ready: true` is selected when the form loads, as before.
- [x] A selected platform that becomes unready stays enabled, so it can be
      unticked, and the existing "saved paused" notice explains it.
- [x] Where no platform is ready, step 3 says so and links to connections
      rather than only refusing to continue.
- [x] "Check again" re-reads the options and keeps every answer already typed.

## Notes

Nothing on the server changes. `POST /api/monitors` still accepts a monitor
whose platform has no key and still saves it paused, because a key can be
deleted between the form loading and the request arriving, and the server is
the authority on that.

## Log

- 2026-09-09T11:05+08:00 — Written.
- 2026-09-09T11:34+08:00 — Done. A platform whose `ready` is false renders a
  disabled box, is not selected when the form opens, and names the key it is
  waiting for on its own card rather than only in a banner. Nothing on the
  server moved.

  Two decisions are worth keeping. **A ticked platform stays enabled**, so a
  key deleted elsewhere leaves a box that can be unticked rather than a
  selection nobody can remove — and that is the only path on which the two
  "saved paused" notices can still fire, which is why they are kept rather
  than deleted as dead UI. And **the options can be read again**: `Check
  again` refetches `/api/monitor-options`, ticks whatever became ready, and
  keeps every typed answer, because the alternative for somebody who leaves to
  paste a key is reloading the page and retyping four fields.

  The dead end is real and intended: with no key at all, step 3 now refuses to
  continue. It says "No platform is connected yet" and offers the connections
  page beside the recheck button. Before today such a person could write a
  whole monitor and save it paused, which cost a model call for a plan nothing
  would ever poll.

  Four new tests cover it, on a two-platform options fixture: the disabled and
  unticked box, the nothing-connected sentence, the recheck picking up a key
  without losing the answers, and a selected platform staying tickable when
  its key goes away. The whole suite passes: 1,593 tests in 93 files.
