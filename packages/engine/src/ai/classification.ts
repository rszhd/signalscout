/**
 * What the model is asked to return, and what we refuse to store.
 *
 * Correctness-critical. docs/testing.md names the failure shape: an invalid
 * score stored as if it were a verdict. `classification.test.ts` holds the
 * assertions, and they were written first.
 *
 * There are two guards, and they are not redundant. This schema refuses a
 * model's answer before a row is built, and it can say why. The check
 * constraints in `db/schema.ts` refuse the row, and they cannot be bypassed by
 * a second caller written later. The first is the one that lets a bad answer
 * be retried; the second is the one that makes "an invalid score is never
 * stored" true rather than merely intended.
 */
import { z } from "zod";
import { intentTypes } from "../vocabulary.js";

/** PLAN.md, *Intent classification*: every dimension is 0 to 100. */
const score = z
  .number()
  .finite()
  .min(0)
  .max(100)
  .describe("0 to 100, where 100 is the strongest signal of this kind");

/**
 * How many claims the inbox shows under "What the model saw".
 *
 * Two is the floor because one claim is an assertion and two are an argument.
 * Five is the ceiling because PLAN.md's inbox card shows a short list, and a
 * model given no ceiling writes a paragraph as bullet points.
 */
export const minimumReasons = 2;
export const maximumReasons = 5;

/** Long enough to name something, short enough to read at a glance. */
const shortestReason = 12;
const longestReason = 160;

/**
 * A phrase that names a score and then gives its value, in either order.
 *
 * "Intent is 88", "Relevance: high", "high intent". The inbox already prints
 * every one of those numbers next to the reasons, so a reason of this shape
 * spends a line of the card saying what the line beside it says. The ticket
 * calls this out: the reason is not decoration.
 *
 * The two halves are separated by punctuation and small connecting words only,
 * so "current problem, not past" survives while "problem fit 96" does not.
 */
const scoreName = "relevance|problem[\\s-]?fit|icp[\\s-]?fit|urgency|intent|lead score|score";
const scoreValue = "\\d{1,3}|high|low|medium|strong|weak|good|poor";

const valueAfterName = new RegExp(
  `\\b(?:${scoreName})\\b[^a-z0-9]{0,12}(?:is|of|at|was|:|=)?[^a-z0-9]{0,6}\\b(?:${scoreValue})\\b`,
  "i",
);

const valueBeforeName = new RegExp(
  `\\b(?:${scoreValue})\\b[^a-z0-9]{0,4}\\b(?:${scoreName})\\b`,
  "i",
);

export function restatesTheScores(reason: string): boolean {
  return valueAfterName.test(reason) || valueBeforeName.test(reason);
}

const reason = z
  .string()
  .trim()
  .min(shortestReason)
  .max(longestReason)
  .refine((value) => !restatesTheScores(value), {
    message: "a reason must cite the post, not restate the scores",
  });

/**
 * The classification, in the order the model writes it.
 *
 * `reasons` is first on purpose. A model that must list what the post says
 * before it puts numbers on it writes its evidence first and scores against
 * it; the other order lets it pick a number and then justify it. The fields
 * after it are PLAN.md's list, unchanged.
 */
export const classificationSchema = z.object({
  reasons: z
    .array(reason)
    .min(minimumReasons)
    .max(maximumReasons)
    .refine(
      (values) => new Set(values.map((value) => value.toLowerCase())).size === values.length,
      { message: "each reason must be a different claim" },
    )
    .describe("Specific claims about this post. Quote or name what it says."),
  relevance: score.describe("Is the post about the area the product is in?"),
  problemFit: score.describe("Does the author describe the problem the product solves?"),
  icpFit: score.describe("Does the author look like the ideal customer?"),
  intent: score.describe("Is the author looking for a solution now?"),
  urgency: score.describe("Is this a current problem rather than a past or hypothetical one?"),
  intentType: z.enum(intentTypes).describe("The kind of intent, or none"),
});

export type Classification = z.infer<typeof classificationSchema>;

/**
 * How the five scores become the one number the inbox sorts on and the monitor
 * threshold is compared against.
 *
 * The model is never asked for this total. A model that returns both the parts
 * and the sum can contradict itself, and nothing downstream could say which
 * half was wrong.
 *
 * The weights follow PLAN.md's own sentence: the product is "an inbox of
 * people who might need your product", so intent — is this person looking for
 * something — carries most, and problem fit next. ICP fit and urgency are
 * modifiers: a post from outside the ideal customer can still be worth
 * reading, and a stale one can still be a lead.
 *
 * **Relevance is not one of the five.** This comment used to say "relevance
 * keeps an off-topic post out", and at a fifth of a weighted sum it did no
 * such thing — intent and urgency carry 45% between them, so a post the
 * classifier scored 0 for relevance and 0 for problem fit could still reach 42
 * and land in somebody's inbox. `relevanceGate` below is what that sentence
 * always meant.
 *
 * These are a stated default, not a measured one. `fixtures/capture.mjs`
 * prints the parts and this total for PLAN.md's four examples, which is the
 * instrument to re-run before changing them.
 */
export const scoreWeights = {
  intent: 0.35,
  problemFit: 0.25,
  relevance: 0.2,
  icpFit: 0.1,
  urgency: 0.1,
} as const;

/**
 * Below this, relevance scales the whole score down instead of contributing a
 * fifth of it.
 *
 * **Found in a live inbox on 2026-09-18.** A monitor for a social listening
 * tool had matched "What can I do to stop these loan offer emails?" at 31 and
 * "Free trial vs Free plan" at 42. The classifier had scored both **0 for
 * relevance and 0 for problem fit** and been overruled by its own weights: the
 * authors wanted something, urgently, and wanted it about something else
 * entirely. Four of that monitor's seventeen matches were this shape.
 *
 * 40 is chosen so that nothing on topic moves. PLAN.md's four worked examples
 * score 45, 94, 95 and 98 for relevance, so all four totals are unchanged —
 * including `low-intent`, which stays at 10 and stays below the threshold for
 * the reason it always did. The gate only reaches posts the classifier itself
 * says are barely about this area.
 *
 * A ratio rather than a cliff, so there is no score at which one point of
 * relevance decides a match. Re-run `capture:classifier` before moving it.
 */
export const relevanceFloor = 40;

/**
 * How much of the weighted total survives, given how on-topic the post is.
 *
 * 1 at or above the floor, and proportional below it: relevance 20 keeps half,
 * relevance 0 keeps none. A post that is not about this area cannot be a lead,
 * however badly its author wants something.
 */
export function relevanceGate(relevance: number): number {
  return Math.min(1, Math.max(0, relevance) / relevanceFloor);
}

export function leadScore(classification: Classification): number {
  const total =
    classification.intent * scoreWeights.intent +
    classification.problemFit * scoreWeights.problemFit +
    classification.relevance * scoreWeights.relevance +
    classification.icpFit * scoreWeights.icpFit +
    classification.urgency * scoreWeights.urgency;

  return Math.round(total * relevanceGate(classification.relevance));
}

/** The scores as the `matches` columns hold them: integers, 0 to 100. */
export function scoreColumns(classification: Classification) {
  return {
    score: leadScore(classification),
    relevance: Math.round(classification.relevance),
    problemFit: Math.round(classification.problemFit),
    icpFit: Math.round(classification.icpFit),
    intent: Math.round(classification.intent),
    urgency: Math.round(classification.urgency),
    intentType: classification.intentType,
    reasons: classification.reasons,
  };
}
