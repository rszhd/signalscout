---
id: US-291
title: A monitor's first poll runs every search
type: feature
priority: p2
created: 2026-09-22T14:40+08:00
parent:
area: pipeline
resolution:
---

## Context

Since US-289 a monitor's searches take turns: each poll adds the hour's
credits and runs the next units while the balance covers them. On a plan
whose hour is worth less than one search — the hosted trial, at four
credits a day across four platforms — a new monitor's first poll runs one
search, and the screen says *next poll in 5 hours*. The owner watched a new
account meet exactly that on 2026-09-22: three of the four platforms they
had chosen were not looked at until the next day.

**The first poll runs everything.** A new monitor is the moment a person
finds out whether the product works, and one search out of four does not
show them. So the poll that finds `last_polled_at` empty runs every unit,
in the monitor's order, and charges them all: the balance goes to the
hour's credits minus the whole turn, and the rotation repays it before the
next turn as it does for one heavy unit today. The day's spend is
unchanged; it is front-loaded. On the trial that is *everything now, then
the next turn in 23 hours*, and the screen already says so, because
`nextTurnAt` is computed off the balance.

**Not a free poll.** Charging it is what keeps it safe: a poll that cost
nothing could be had again by deleting the monitor and making it again,
and on a ten-project plan that is ten projects of free fetches an hour.
The ceiling (US-287) still bounds the model side of the first poll to 25
new posts a pair.

**Where the first poll is known.** `collect.ts` reads the monitor before
it marks `last_polled_at`, so the mark being null is the fact, and it is
handed to `nextTurn` as `first`. The rule is in the pure function, so the
test walks a trial's first day in a loop.

## Acceptance

- [ ] `nextTurn` with `first: true` returns every unit in the monitor's
      order, whatever the balance, and a balance of the hour's credits
      (capped as today) minus the whole turn. The cursor is unchanged: a
      full turn ends where it began.
- [ ] A trial-shaped state — four units, 0.167 credits an hour, balance
      zero — runs four units on the first poll, nothing for the next 22
      polls, and one unit on the 23rd. Over the first 24 polls it spends
      four credits, the same as before.
- [ ] `first: false` (and absent) behaves exactly as today; every existing
      case in `rotation.test.ts` passes unchanged.
- [ ] `collect.ts` passes `first: monitor.lastPolledAt === null`, and a
      step test (`rotation-steps.test.ts`) shows a new monitor with more
      searches than its hour covers collecting from every one of them on
      the first poll and from none on the second.
- [ ] `docs/pipeline.md`'s turn paragraph says the first poll is the whole
      turn, and `CHANGELOG.md` carries it under the next version.

## Notes

- The hosted application's `nextTurnOf` already computes the next turn
  from a negative balance, so the screen needs no change for this.
- A monitor that is edited later gets no second full turn: the mark is set
  by then, and the new units take their place in the rotation. A monitor
  resumed after a pause already runs a full turn, because the balance is
  capped at one.

## Log
