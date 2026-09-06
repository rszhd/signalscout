---
id: US-052
title: A monitor does not poll overnight
type: feature
priority: p2
created: 2026-09-07T00:25+08:00
parent: US-051
area:
resolution:
---

## Context

**A lead has a shelf life, and polling at 03:00 spends it while nobody is
reading.** The owner's case, in their words: they do not want a run fetching X
at night, and then to wake up to tweets that are already eight to twelve hours
old. On X a conversation moves in hours — US-006 measured a query returning
nothing at 20:12 and twenty posts at 20:31 — so a match found at 03:00 and read
at 11:00 has had eight hours for somebody else to answer it.

This is a **freshness** argument, and it is stronger than the one `patrol`'s
equivalent rests on. Patrol wants runs landing while somebody is at their desk.
Here the poll is unattended either way; what matters is how old the newest lead
is at the moment a person opens the inbox.

**A start hour does not solve it, and that is the trap to avoid.** Patrol's
control anchors the slots: "every 6 hours from 08:00" fires at 02:00, 08:00,
14:00 and 20:00. The 02:00 poll is exactly the one this ticket exists to stop.
Copying that control would look like the feature and not be it.

**What answers the case is a window.** "Every 3 hours between 08:00 and 23:00"
fires at 08, 11, 14, 17, 20 and 23 — nothing overnight, and the 08:00 poll
sweeps everything said during the night in one go. That is the shape a person
means by "check it during my day": the overnight conversation is not missed,
it is collected at the moment somebody is about to read it.

It is also cheaper. Fifteen hours of a day is five eighths of the polls, on top
of whatever the day set already saves.

**The hard part is the scheduler, not the control.** `findDueMonitors` asks
`last_polled_at + interval <= now()`, which has no concept of a time of day at
all — a monitor is due whenever enough time has passed. A window means the
query also asks whether the local hour is inside it, and that is the small
half. The real questions are what happens at the edges:

* **The first poll after the window opens.** With a plain interval check, a
  monitor whose window opens at 08:00 and was last polled at 22:00 is already
  overdue and fires at 08:00 — which is what we want, and comes free.
* **A window that has been closed longer than the interval** must not fire a
  burst of catch-up polls when it opens. The guard is that a poll sets
  `last_polled_at`, so only one can be due at a time; this needs an assertion
  rather than an assumption.
* **A window crossing midnight** — 22:00 to 06:00 — is a real thing somebody
  will ask for, and `hour >= from AND hour < to` is wrong for it. Either
  support the wrap and test it, or refuse it and say so.
* **The zone is already there.** `monitors.poll_timezone` exists and
  `findDueMonitors` already reads `now() AT TIME ZONE` for the day check, so
  the window is counted on the same clock as the days. Nothing new is needed
  for that, and nothing may quietly count it in UTC.

**Everything the window does must be visible before it is saved.** US-051's
summary already prints the rate, the days and the cost; a window changes all
three. "Polls every 3 hours between 08:00 and 23:00 on weekdays — about 65
polls a month" is the sentence, and it is the only place a person sees what
they are actually buying.

## Acceptance

- [ ] A monitor stores an active window — an hour it starts and an hour it
      stops — alongside its interval and its days, in a migration that leaves
      every existing monitor polling exactly as it does today
- [ ] `findDueMonitors` refuses a monitor whose local hour is outside its
      window, counted in `monitors.poll_timezone` like the day check beside it
- [ ] A monitor whose window has been shut longer than its interval polls
      **once** when the window opens, not once for every interval it missed
- [ ] A window that crosses midnight either works and has a test, or is refused
      with a message that says why
- [ ] The default is the whole day, so nothing changes for a monitor nobody
      edits and no migration has to guess at somebody's sleeping hours
- [ ] The schedule control offers the window, and the summary counts it: the
      rate, the days, the window and the polls a month in one sentence
- [ ] The projection in `estimate/` uses the same arithmetic as the summary.
      BUG-005 was a hint and a quote disagreeing, and a window is a third place
      for that to happen

## Notes

- Depends on [US-051](../done/2026-09/US-051-a-schedule-asks-two-questions.md),
  which is the control this adds a third question to.
- **Do not copy `patrol`'s start hour.** It is the right control for a
  slot-based scheduler and the wrong one for this case: anchoring the slots
  still leaves a poll in the middle of the night. Read
  `frontend/src/WatchCheck.jsx` there for the control's shape, and its US-117
  for the reasoning, but the model here is a window rather than an anchor.
- A window is not quiet hours for *notifications*. US-016 already delivers
  digests and immediate alerts, and somebody who wants the polling to continue
  but the emails to wait is asking for a different setting on a different
  table. Say so if it comes up rather than widening this.
- The cheapest version of this ticket is the scheduler half with no control:
  a window that defaults to the whole day changes nothing until something sets
  it. If it has to be split, ship the column and the query first — a control
  over a scheduler that ignores it is the failure `?comment_id=` already taught
  this repository once.

## Log

- 2026-09-07T00:25+08:00 — Written at the owner's request, straight after
  US-051 split the control. They gave the case themselves: no fetching X
  overnight, and no waking up to leads that are already half a day old. That
  case is what makes it a window rather than the start hour `patrol` offers.
