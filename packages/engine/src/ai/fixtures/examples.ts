/**
 * PLAN.md's four worked examples, as a labelled set.
 *
 * docs/testing.md, *Testing the model*: PLAN.md already holds four posts with
 * the intent scores they should receive, from "Playwright is awesome" at 3 to
 * a four-person SaaS asking what other teams use at 96. That is an evaluation
 * set on day one. This file is it, in code, so that `capture.ts` and
 * `examples.test.ts` cannot disagree about what was asked.
 *
 * The posts are the same objects the fake source serves, so the pipeline tests
 * and the classifier's labelled set talk about the same four posts.
 *
 * **The bands were written before the first capture ran.** They are wide on
 * purpose: they are the claim "the model can tell these four apart", not a
 * pin on any one number. A capture that falls outside one is a red test, and
 * the house rule sends the fix to the prompt, not to the band.
 */
import { fakePosts } from "../../sources/fake/fixtures.js";
import type { MonitorProfile, PostForClassification } from "../prompt.js";

/** The monitor these four posts are scored against. A test runner, as in PLAN.md. */
export const exampleMonitor: MonitorProfile = {
  product:
    "A test runner for web apps. You record a browser flow once and it keeps working when the UI changes.",
  idealCustomer:
    "Small SaaS teams, two to twenty people, with no dedicated QA engineer, shipping every week.",
  problem:
    "End-to-end tests break whenever the UI changes, so teams stop trusting them and go back to testing by hand before every release.",
  signals: ["recommendation_request", "problem", "alternative_search"],
};

export interface LabelledExample {
  /** The fixture file this example is recorded in. */
  readonly slug: string;
  /** What PLAN.md calls it. */
  readonly label: string;
  readonly post: PostForClassification;
  /** The intent score PLAN.md gives it. */
  readonly plannedIntent: number;
  /** The band the model's intent score must fall in. Inclusive. */
  readonly intentBand: readonly [number, number];
}

function postAt(index: number): PostForClassification {
  const post = fakePosts[index];
  if (!post) throw new Error(`fakePosts has no entry ${index}.`);

  return {
    source: "reddit",
    channel: post.channel,
    author: post.author,
    title: post.title,
    excerpt: post.text,
    postedAt: post.postedAt,
  };
}

export const labelledExamples: readonly LabelledExample[] = [
  {
    slug: "low-intent",
    label: "Low intent",
    post: postAt(0),
    plannedIntent: 3,
    intentBand: [0, 25],
  },
  {
    slug: "mild-problem-signal",
    label: "Mild problem signal",
    post: postAt(1),
    plannedIntent: 50,
    intentBand: [25, 75],
  },
  {
    slug: "strong-intent",
    label: "Strong intent",
    post: postAt(2),
    plannedIntent: 90,
    intentBand: [70, 100],
  },
  {
    slug: "very-strong-intent",
    label: "Very strong intent",
    post: postAt(3),
    plannedIntent: 96,
    intentBand: [80, 100],
  },
];

/** What one captured answer looks like on disk. */
export interface CapturedClassification {
  readonly slug: string;
  readonly provider: string;
  readonly model: string;
  readonly capturedAt: string;
  /** The model's answer, as the AI SDK parsed it. */
  readonly object: Record<string, unknown>;
  readonly usage: { readonly inputTokens?: number; readonly outputTokens?: number };
  readonly latencyMs: number;
  readonly estimatedCostMicros?: number;
}
