---
id: US-051
title: A schedule asks two questions, not one
type: feature
priority: p2
created: 2026-09-07T00:20+08:00
parent: US-041
area:
resolution: shipped
---

## Context

US-041 shipped a schedule control that offered nine choices in one dropdown.
Each was a rate and a set of days welded together — "Every hour, weekdays" is
the hourly rate on a set of five — so the only schedules reachable were the
ones somebody had thought to name.

**A schedule answers two questions and they are independent**: how often, and
which days. Separated, six rates and any day set are reachable with one fewer
thing to read. Monday, Wednesday and Friday could not be expressed at all, and
it is three sevenths of the cost of the same rate every day.

The shape is taken from `patrol`'s `RepeatField`, which separates the same two
questions and was the owner's reference.

**The count is the reason the summary exists.** Poll frequency is the largest
cost dial in this product — the same query is $10.80 a month polled hourly and
$648 polled every minute — and the old control put that number inside an option
label, where it was read once and never compared.

## Acceptance

- [x] How often and which days are two controls, not one list of pairs
- [x] Days are ticked directly, so a set no rule names is reachable
- [x] The day rule is read back off the set rather than stored, so unticking one
      day of "Weekdays" moves the select to "Chosen days" on its own
- [x] The last day cannot be unticked: a monitor with no days is never due and
      the API refuses one
- [x] A summary under both controls says the schedule and its cost, and moves
      as either control is touched
- [x] One component, used by the monitor form and the monitor list
- [x] A schedule that matches no named rate still says what it does rather than
      being rounded to the nearest and changed on the next save

## Notes

- `patrol`'s start hour is deliberately not copied here. It fires on fixed
  slots and this polls on interval-since-last-poll, so an hour would be stored
  and never read. [US-052](../../todo/US-052-a-monitor-does-not-poll-overnight.md)
  is the ticket that makes times real, and it is a scheduler change rather than
  a control.

## Log

- 2026-09-07T00:20+08:00 — Built at the owner's request, after they pointed at
  `patrol`'s scheduler UI. The combined list, its lookup and its hint builder
  were deleted rather than left: nothing read them, and a second idea of what
  schedules exist is how two screens drift apart.

  Written up after the fact. The code carried a `US-051` reference before this
  file existed, which is the wrong order and is recorded here rather than
  quietly tidied.
