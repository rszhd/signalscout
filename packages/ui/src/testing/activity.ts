/**
 * A monitor's history rows, for a test or a story. US-353.
 *
 * Our own response shape, beside the monitor and poll rows it is built from:
 * a poll entry wraps `poll()`, and a stage entry is the classifier's run after
 * it, the shape `/api/monitors/:id/activity` sends.
 */
import type { ActivityEntry, StageRun } from "../monitor.js";
import { poll } from "./monitors.js";

export function pollEntry(overrides: Record<string, unknown> = {}): ActivityEntry {
  const run = poll(overrides) as unknown as Extract<ActivityEntry, { kind: "poll" }>["poll"];
  return { kind: "poll", at: run.startedAt, poll: run };
}

export function stageEntry(overrides: Partial<StageRun> = {}): ActivityEntry {
  const at = overrides.startedAt ?? "2026-03-14T08:05:00.000Z";
  return {
    kind: "stage",
    at,
    stage: {
      id: "stage-1",
      stage: "classify",
      walkId: "walk-1",
      pollRunId: "poll-1",
      startedAt: at,
      finishedAt: at,
      outcome: "done",
      itemsIn: 12,
      itemsOut: 3,
      units: 12,
      estimatedCostMicros: 3000,
      detail: {
        stage: "classify",
        scored: 12,
        matched: 3,
        unclassified: 0,
        dropped: 0,
        leftByCap: 0,
      },
      stopReason: null,
      ...overrides,
    },
  };
}
