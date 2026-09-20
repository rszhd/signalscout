---
id: US-275
title: The schedule's words are shared
type: chore
priority: p2
created: 2026-09-20T18:07+08:00
parent: US-270
area: web
resolution:
---

## Context

`apps/web/src/schedule.ts` differs by 12 lines between the two applications,
and all 12 are one function the hosted one added for its plan cards
(`pollRateLabel`). Everything else is the same: `pollRates`, `everyDay`,
`describeSchedule`, `browserTimezone`, `timezoneOptions`, `defaultRate`.

They are words and arithmetic about a schedule, which is the class of thing
US-270 already moved — `pollSummary`, `stageLabel`, `monitoringState`. The
reason is the same: "every 6 hours" said twice becomes two sentences the first
time one is edited, and the two products show the same monitor's schedule.

The hosted application does not offer the schedule as a control any more
(US-173 there), and it still describes one on its monitor screens. That is why
sharing the words is right and sharing a control would not be: `ScheduleField`
stays in this application, where a person still chooses.

Take the hosted copy, which is the same plus `pollRateLabel`. An extra function
neither screen has to call is cheaper than two files that agree today.

## Acceptance

- [ ] `pollRates`, `everyDay`, `defaultRate`, `describeSchedule`,
      `pollRateLabel`, `browserTimezone` and `timezoneOptions` are exported
      from `@signalscout/ui`.
- [ ] `apps/web/src/schedule.ts` is deleted here and every caller imports from
      the package; `ScheduleField.tsx` stays in the application.
- [ ] The words' tests move to the package and pass there.
- [ ] `minimumPollIntervalSeconds` stays the pipeline's: a rate list on a
      screen is not a rule about what the worker accepts.
- [ ] US-271 in the hosted repository names this file too.

## Notes

- `apps/web/src/schedule.ts`, `ScheduleField.tsx`, `MonitorForm.tsx`,
  `MonitorDetail.tsx`.
- `packages/ui/src/monitor.ts` is where the other words are.
- The hosted copy is `signalscout-cloud/apps/web/src/schedule.ts`.

## Log

- 2026-09-20T18:07+08:00 — Written after the survey: 12 lines apart, and the
  12 are additive.
