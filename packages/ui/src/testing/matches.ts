/**
 * A match row as `/api/matches` sends it, for a test or a story. US-352.
 *
 * Our own response shape, like the monitor rows beside it: one builder so the
 * package's tests, its stories and each application's inbox tests read the
 * same row. `postedAt` is twelve minutes before the call, so an age label
 * reads the same whenever a test runs.
 */
import type { Match } from "../match.js";
import { testMonitorId } from "./monitors.js";

export function match(overrides: Partial<Match> = {}): Match {
  return {
    id: "match-1",
    monitorId: testMonitorId,
    monitorName: "QA automation leads",
    score: 94,
    problemFit: 98,
    icpFit: 91,
    intent: 94,
    intentLabel: "Describing the problem",
    reasons: ["Small SaaS team", "Explicit manual-testing pain", "Asking for solutions"],
    verdict: null,
    source: "reddit",
    channel: "SaaS",
    author: "someone",
    title: "How are small teams handling regression testing?",
    excerpt: "We're manually checking our major flows before every release.",
    kind: "post",
    parentTitle: null,
    parentExcerpt: null,
    parentUrl: null,
    parentRepliesRead: null,
    parentReplyCount: null,
    parentRepliesStopped: null,
    saved: false,
    replied: false,
    url: "https://reddit.com/r/SaaS/comments/abc",
    postedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    ...overrides,
  };
}
