/**
 * The monitor rows the two monitor screens are tested against. US-109.
 *
 * One builder, because the list and the monitor page read the same response
 * and a second copy is how the two screens end up tested against two different
 * APIs. It is not a fixture of somebody else's payload: this is our own
 * response shape, written down beside the schema that produces it.
 */

export const testMonitorId = "11111111-1111-4111-8111-111111111111";

/** The project every case is inside. A monitor list is a question about one. */
export const testProjectId = "p1";

export function monitor(overrides: Record<string, unknown> = {}) {
  return {
    id: testMonitorId,
    projectId: testProjectId,
    name: "Teams replacing manual QA",
    sources: ["reddit"],
    paused: false,
    lastPolledAt: "2026-03-14T08:00:00.000Z",
    // US-041. Hourly, every day: what every monitor did before there was a
    // control for it.
    pollIntervalSeconds: 3600,
    pollDays: [0, 1, 2, 3, 4, 5, 6],
    pollTimezone: "UTC",
    lastCollected: [],
    missingCredentials: [],
    budget: null,
    spend: {
      sourceMicros: 0,
      modelMicros: 0,
      totalMicros: 0,
      remainingMicros: null,
      exhausted: false,
      reason: null,
      since: "2026-03-01T00:00:00.000Z",
    },
    preFilter: {
      enabled: true,
      similarityThreshold: 0.15,
      dropped: { keyword: 0, embedding: 0, triage: 0 },
      read: 0,
    },
    feedback: { good: 0, notRelevant: 0 },
    matches: { total: 0, unread: 0 },
    ...overrides,
  };
}

/**
 * What a poll did. US-104.
 *
 * The defaults are the production run of 2026-09-09, scaled to one platform: a
 * poll that asked, was billed, and returned nothing.
 */
export function poll(overrides: Record<string, unknown> = {}) {
  return {
    id: "poll-1",
    walkId: "walk-1",
    startedAt: "2026-03-14T08:00:00.000Z",
    finishedAt: "2026-03-14T08:01:00.000Z",
    outcome: "empty",
    postsReturned: 0,
    postsNew: 0,
    units: 67,
    estimatedCostMicros: 543_906,
    stopReason: null,
    sources: [
      {
        source: "reddit",
        provider: "socialcrawl",
        pages: 5,
        postsReturned: 0,
        postsNew: 0,
        units: 67,
        estimatedCostMicros: 543_906,
        reason: null,
      },
    ],
    ...overrides,
  };
}
