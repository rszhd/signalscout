---
id: US-089
title: The setup forms use familiar sample copy
type: chore
priority: p3
created: 2026-09-09T17:42+08:00
area: web
resolution: shipped
---

## Context

The setup forms had sample text that leaned too hard on QA-specific phrasing.
That worked as an internal example, but it did not read as a common product to
most people filling the form.

The placeholder copy should stay ordinary. A person should understand the sample
at a glance and replace it with their own business without first translating the
example.

## Acceptance

- [x] The monitor form uses a familiar product sample in its product field.
- [x] The project form uses familiar sample copy in its product, audience and
      problem fields.
- [x] The new copy still fits the existing field lengths and layout.
- [x] The focused web tests for the changed screens pass.

## Notes

The change stays in `apps/web/src/MonitorForm.tsx` and `apps/web/src/Projects.tsx`.
No route, validation or saved data shape changes are needed.

## Log

- 2026-09-09T17:42+08:00 — Written after the owner asked for more familiar
  sample copy. The old QA-flavored examples were replaced with more common
  software products so the forms read more naturally at first glance.
