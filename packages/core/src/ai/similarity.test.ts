/**
 * The pre-filter's threshold, against numbers a real model produced.
 *
 * `fixtures/similarities.json` holds the cosine similarity between PLAN.md's
 * example monitor and the fake source's five posts, measured by a live
 * embedding model and recorded by `fixtures/capture-embeddings.ts`. This file
 * spends nothing and reaches nothing: it reads those numbers back and asks the
 * one question the second stage exists to answer.
 *
 * **The claim.** A threshold has to sit between the on-topic posts and the
 * off-topic one. Above the lowest on-topic post it drops a lead the classifier
 * was meant to judge, and nobody can see that happen. Below the sourdough post
 * it drops nothing and pays for the embeddings anyway.
 *
 * **What this cannot say.** That the embedding stage judges intent. It does
 * not, and it is not meant to: "Playwright is awesome" is about the monitor's
 * subject and sits well above the threshold, while PLAN.md scores its intent
 * at 3. The classifier is what rejects it, at a hundred times the price. The
 * pre-filter's job is only to keep the sourdough out of that bill.
 *
 * The numbers are as fresh as the capture, which is why the capture is
 * committed and re-runnable.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultSimilarityThreshold, embeddingDimensions } from "../db/schema.js";

interface RecordedSimilarity {
  readonly externalId: string;
  readonly title: string | null;
  readonly similarity: number;
}

interface RecordedSimilarities {
  readonly provider: string;
  readonly model: string;
  readonly capturedAt: string;
  readonly dimensions: number;
  readonly monitorText: string;
  readonly similarities: readonly RecordedSimilarity[];
}

function recorded(): RecordedSimilarities {
  try {
    return JSON.parse(
      readFileSync(new URL("./fixtures/similarities.json", import.meta.url), "utf8"),
    ) as RecordedSimilarities;
  } catch {
    throw new Error(
      "No recorded similarities. Run `pnpm --filter @intentwatch/core capture:embeddings` " +
        "with an embedding key. A model's answer is recorded, never written.",
    );
  }
}

const measurement = recorded();

/** The four posts PLAN.md scores. Every one is about the monitor's subject. */
const onTopic = measurement.similarities.filter((entry) => entry.externalId !== "fake-5");
/** The sourdough post. The only one in the set that is about something else. */
const offTopic = measurement.similarities.find((entry) => entry.externalId === "fake-5");

describe("what a real embedding model measured", () => {
  it("returns vectors the column can hold", () => {
    // A model of another width is refused by the embedder rather than written,
    // and this is the recorded proof that the configured one is not.
    expect(measurement.dimensions).toBe(embeddingDimensions);
  });

  it("puts every post about the monitor's subject above the post about baking", () => {
    const lowestOnTopic = Math.min(...onTopic.map((entry) => entry.similarity));

    expect(offTopic?.similarity).toBeLessThan(lowestOnTopic);
  });
});

describe("the default threshold", () => {
  it("keeps every post the classifier was meant to judge", () => {
    // The failure this guards is silent: a post dropped here never reaches the
    // model, never becomes a match, and leaves nothing in the inbox to notice.
    for (const entry of onTopic) {
      expect(entry.similarity).toBeGreaterThanOrEqual(defaultSimilarityThreshold);
    }
  });

  it("drops the post that is about something else", () => {
    expect(offTopic?.similarity).toBeLessThan(defaultSimilarityThreshold);
  });

  it("sits inside the gap with room on both sides", () => {
    // A threshold at the very edge of the measured gap is one bad post away
    // from dropping a good lead. The margin is what makes 0.15 a choice rather
    // than a coincidence.
    const lowestOnTopic = Math.min(...onTopic.map((entry) => entry.similarity));

    expect(defaultSimilarityThreshold - (offTopic?.similarity ?? 0)).toBeGreaterThan(0.02);
    expect(lowestOnTopic - defaultSimilarityThreshold).toBeGreaterThan(0.02);
  });
});
