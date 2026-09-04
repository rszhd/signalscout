/**
 * The signals reach both prompts from one place.
 *
 * US-010's acceptance asks for this, and the ticket says what it costs when it
 * is false: a monitor searches for hiring posts, the classifier is never told
 * that hiring counts, and the monitor rejects its own results. Nothing in the
 * product shows that. The queries look right, the scores look right, and the
 * inbox is empty.
 *
 * The assertion that matters is not "the selected signal appears". A prompt
 * that pasted all seven signals would pass that one. It is the pair: the
 * selected signal appears in both prompts, and the unselected one appears in
 * neither.
 */
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../ai/prompt.js";
import { buildQueryUserPrompt } from "../ai/queries.js";
import { intentTypes, signals } from "../db/schema.js";
import { describeSignals, intentTypeLabel, signalDescriptions, signalList } from "./signals.js";

const monitor = {
  product: "A test runner that records browser flows instead of coding them",
  idealCustomer: "Small SaaS teams with no dedicated QA engineer",
  problem: "End-to-end tests break whenever the UI changes",
  signals: ["hiring"] as const,
};

describe("the list of signals", () => {
  it("describes every signal the schema names", () => {
    expect(signalList.map((signal) => signal.id)).toEqual([...signals]);
  });

  it("keys every description by its own id", () => {
    for (const signal of signals) {
      expect(signalDescriptions[signal].id).toBe(signal);
    }
  });

  it("gives every signal a label, a hint and a sentence for the model", () => {
    for (const signal of signalList) {
      expect(signal.label.length).toBeGreaterThan(0);
      expect(signal.hint.length).toBeGreaterThan(0);
      // The model sentence names a behaviour, so it is longer than the label.
      expect(signal.describes.length).toBeGreaterThan(signal.label.length);
    }
  });
});

describe("a selected signal", () => {
  const hiring = signalDescriptions.hiring.describes;

  it("reaches the classifier prompt", () => {
    expect(buildSystemPrompt(monitor)).toContain(hiring);
  });

  it("reaches the query generator's prompt", () => {
    expect(buildQueryUserPrompt(monitor)).toContain(hiring);
  });

  it("reaches both in the same words", () => {
    // Not two paraphrases that happen to agree today. The same string, from
    // the same file, or this test is asserting a coincidence.
    expect(describeSignals(["hiring"])).toContain(hiring);
    expect(buildSystemPrompt(monitor)).toContain(describeSignals(["hiring"]));
    expect(buildQueryUserPrompt(monitor)).toContain(describeSignals(["hiring"]));
  });
});

describe("a signal the user did not tick", () => {
  const comparison = signalDescriptions.comparison.describes;

  it("is absent from the classifier prompt", () => {
    expect(buildSystemPrompt(monitor)).not.toContain(comparison);
  });

  it("is absent from the query generator's prompt", () => {
    expect(buildQueryUserPrompt(monitor)).not.toContain(comparison);
  });
});

describe("no signals at all", () => {
  const noPreference = { ...monitor, signals: [] as const };

  it("tells both prompts the same thing", () => {
    expect(describeSignals([])).toBe("none stated");
    expect(buildSystemPrompt(noPreference)).toContain("none stated");
    expect(buildQueryUserPrompt(noPreference)).toContain("none stated");
  });

  it("does not silently mean every signal", () => {
    const prompt = buildSystemPrompt(noPreference);

    for (const signal of signalList) {
      expect(prompt).not.toContain(signal.describes);
    }
  });
});

describe("the words on an inbox card", () => {
  it("gives every answer the classifier may return a label", () => {
    // The classifier answers with one of `intentTypes`, and the inbox prints
    // it. A type with no label would reach a card as a bare id, and only the
    // card would be wrong: the prompt, the schema and the row would all look
    // right. US-011.
    for (const intentType of intentTypes) {
      expect(intentTypeLabel(intentType)).toMatch(/[a-z]/);
      expect(intentTypeLabel(intentType)).not.toBe(intentType);
    }
  });

  it("uses the label the checkbox used", () => {
    for (const signal of signals) {
      expect(intentTypeLabel(signal)).toBe(signalDescriptions[signal].label);
    }
  });
});
