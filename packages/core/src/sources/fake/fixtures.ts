import type { CandidatePost } from "../types.js";

/**
 * The fake source's posts.
 *
 * These are written, not captured, and that is correct: they are
 * `CandidatePost` values, which is our shape, not a Reddit or X payload. The
 * rule in docs/testing.md — a fixture for someone else's API is captured, never
 * written — applies one layer down, to the raw JSON the real connectors parse.
 * Nothing here may ever grow a field named after a provider.
 *
 * The first four texts are PLAN.md's worked examples, with the intent scores it
 * gives them: 3, 50, 90 and 96 out of 100. Reusing them means the pipeline
 * tests and the classifier's labelled set talk about the same posts. The fifth
 * is unrelated to any product, so a filter test has something that must be
 * dropped.
 */
export const fakePosts: readonly CandidatePost[] = [
  {
    externalId: "fake-1",
    url: "https://example.test/fake/1",
    author: "quiet_fan",
    channel: "webdev",
    title: "Playwright is awesome",
    text: "Playwright is awesome.",
    postedAt: new Date("2026-08-01T09:00:00.000Z"),
  },
  {
    externalId: "fake-2",
    url: "https://example.test/fake/2",
    author: "tired_qa",
    channel: "QualityAssurance",
    title: "Tests break on every UI change",
    text: "Our Playwright tests break whenever the UI changes.",
    postedAt: new Date("2026-08-02T09:00:00.000Z"),
  },
  {
    externalId: "fake-3",
    url: "https://example.test/fake/3",
    author: "suite_owner",
    channel: "QualityAssurance",
    title: "Is there something easier?",
    text: "Our Playwright suite is becoming impossible to maintain. Is there something easier?",
    postedAt: new Date("2026-08-03T09:00:00.000Z"),
  },
  {
    externalId: "fake-4",
    url: "https://example.test/fake/4",
    author: "four_person_saas",
    channel: "SaaS",
    title: "What are other small teams using?",
    text:
      "We're a four-person SaaS and still manually test signup and checkout every release. " +
      "What tools are other small teams using?",
    postedAt: new Date("2026-08-04T09:00:00.000Z"),
  },
  {
    externalId: "fake-5",
    url: "https://example.test/fake/5",
    author: "sourdough_person",
    channel: "Baking",
    title: "My starter died",
    text: "My sourdough starter died over the weekend and I do not know why.",
    postedAt: new Date("2026-08-05T09:00:00.000Z"),
  },
];
