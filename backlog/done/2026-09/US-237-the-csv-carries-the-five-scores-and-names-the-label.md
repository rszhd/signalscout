---
id: US-237
title: The CSV carries the five scores and names the label
type: feature
priority: p2
created: 2026-09-19T22:55+08:00
parent:
area: pipeline
resolution: shipped
---

## Context

**The `intent` column is a label, and a reader expects a number.** The inbox
shows an intent score of 75 beside the words "Asking for recommendations",
and the CSV writes the words under the heading `intent`. BUG-026 in the cloud
repository was the same mistake one screen over: a badge called "Low intent"
that was reading the total score. A column named after a score should hold a
score.

**The five dimension scores are not in the file.** `score` is the weighted
total, and a person sorting a spreadsheet to find the urgent ones, or the
ones that fit the customer profile, has nothing to sort by. The row already
carries `relevance`, `problemFit`, `icpFit`, `intent` and `urgency`; the
writer left them out.

**The label column is renamed rather than replaced.** Writing the score under
the old heading would change the meaning of a column somebody has already
mapped into a CRM import. `intent_label` says what it is, and the score goes
under `intent_score` beside its four siblings, so no existing column changes
meaning: one is renamed, six are added.

**The scores go last.** The column order is the order a person scans: the
total, what it is, the words, the link, the provenance. Five numbers between
the total and the words would push the words off the first screen. Detail
belongs after the row is understood.

## Acceptance

- [x] The header names `intent_label`, not `intent`
- [x] The row carries `relevance`, `problem_fit`, `icp_fit`, `intent_score`
      and `urgency` after `saved`, as whole numbers
- [x] No existing column changes meaning
- [x] The header test lists the columns in full

## Notes

- Not a new export and not a changed signature, but a consumer who parses the
  file by heading must rename one. The changelog entry says so under
  **Changed**.
- The excerpt stays capped at `excerptLength` (2000). 558 of 5011 stored posts
  hit the cap on the local database on 2026-09-19. The screen shows the same
  cut, so the file is consistent with it. Not changed here.

## Log

- 2026-09-19T22:55+08:00 — Written after the owner asked whether the export
  carried the right data. It did: eight rows in, eight rows out, every cell
  matched. What it lacked was the scores, and one heading was misnamed.

- 2026-09-19T23:05+08:00 — Done. Six columns, one rename, and the header
  test lists all seventeen. Unreleased; goes out with US-234.
