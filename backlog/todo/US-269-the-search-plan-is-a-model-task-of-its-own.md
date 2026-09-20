---
id: US-269
title: The search plan is a model task of its own
type: feature
priority: p2
created: 2026-09-20T09:12+08:00
parent:
area: api
resolution:
---

## Context

Writing a monitor's search plan uses the classifier's model. Classification
reads one post at a time and the price decides what a person can afford, so
the classifier's model is chosen cheap. Writing the plan is the opposite
shape. It happens once when a monitor is made and again when somebody
regenerates it, and what it produces decides every post the monitor will
ever collect. A weak plan is not a cheap mistake; it is a month of polling
for the wrong conversations. A generation is a few thousand tokens once, so
a model twenty times the price costs cents.

The hosted application solved this as US-208 there with one environment
variable, because its models are the instance's. Here the keys and the
models are the person's, and the Models screen already lets them choose a
model per task: `classify`, `triage`, `embed`, `draft`. The flexible shape is
a fifth task, `plan`, on that screen, falling back to `classify` when unset
so no existing instance changes behaviour on the upgrade.

`aiTasks` is the engine's vocabulary, so this is a package change first and
an application change second, built against the working copy and released
once.

## Acceptance

- [ ] `aiTasks` in the engine has `plan`; the boundary tests still pass.
- [ ] The pipeline's per-account model settings accept `plan`, and reading
      the settings for an account without one answers the `classify` choice.
- [ ] `queryGeneratorForEnvironment` uses the `plan` task's provider, key,
      model and base URL.
- [ ] The Models screen has a *Writing the search plan* card that says the
      call is rare and worth a strong model.
- [ ] A test proves a plan written after choosing a `plan` model records
      that model in `api_usage`, and that a triage or classify call does not
      move.
- [ ] `docs/costs.md` names the task and the changelog says what the field
      means to a consumer.

## Notes

- `packages/engine/src/vocabulary.ts:169` — `aiTasks`.
- `apps/api/src/models.ts:92` — `taskViews`, the words for each task.
- `apps/api/src/server.ts:322` — `queryGeneratorForEnvironment`.
- `apps/api/src/monitors.ts:669` — `generatorFor`, US-068.
- The describe-from-URL call is the same shape and may share the task.

## Log

- 2026-09-20T09:12+08:00 — Written from the cross-repository review of the
  cloud's changes since the split.
