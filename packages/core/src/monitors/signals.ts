/**
 * What each signal means, written once.
 *
 * US-010 asks for this by name: the signals a user ticks must reach the query
 * generator and the classifier prompt from one place. The ticket says why. A
 * monitor that searches for hiring posts and then scores them without knowing
 * that hiring counts rejects its own results, and nothing in the product can
 * show that it happened — the queries look right, the scores look right, and
 * the inbox is empty.
 *
 * Two lists drift. One cannot. So the form's labels, the query generator's
 * instructions and the classifier's instructions all read this file.
 *
 * The ids are the same strings as `intentTypes` in the schema. That is not a
 * coincidence to be tidied away: the classifier is asked to answer with one of
 * those words, so it should have been told to look for the same words.
 */
import { type Signal, signals } from "../db/schema.js";

export interface SignalDescription {
  readonly id: Signal;
  /** The checkbox label. PLAN.md, *Monitor creation*. */
  readonly label: string;
  /** An example under the label, so a user picks by recognition, not by guess. */
  readonly hint: string;
  /**
   * One sentence naming what the author of such a post does.
   *
   * Written for a model, not for a person: it names the behaviour rather than
   * the category, because "purchase" alone tells a model nothing it did not
   * already assume.
   */
  readonly describes: string;
}

export const signalDescriptions: Readonly<Record<Signal, SignalDescription>> = {
  recommendation_request: {
    id: "recommendation_request",
    label: "Asking for recommendations",
    hint: "“What are other teams using?”",
    describes: "asks other people which tool, service or approach they use",
  },
  alternative_search: {
    id: "alternative_search",
    label: "Looking for alternatives",
    hint: "“Is there something easier than this?”",
    describes: "names a tool they already use and asks whether something better exists",
  },
  competitor_complaint: {
    id: "competitor_complaint",
    label: "Complaining about their current solution",
    hint: "Frustration with a tool they already pay for",
    describes: "complains about a tool or service they already use, without asking for another",
  },
  problem: {
    id: "problem",
    label: "Describing the problem",
    hint: "Clear pain, even without asking for a product",
    describes: "describes the problem in their own words and names no tool at all",
  },
  comparison: {
    id: "comparison",
    label: "Comparing products",
    hint: "Weighing two or more options",
    describes: "weighs two or more named options against each other",
  },
  purchase: {
    id: "purchase",
    label: "Ready to buy",
    hint: "Asking about price, trials or how to start",
    describes: "is ready to pay: asks about price, a trial, or how to get started",
  },
  hiring: {
    id: "hiring",
    label: "Looking to hire someone",
    hint: "Trying to pay a person to solve it",
    describes: "wants to pay a person or an agency to solve the problem instead of buying a tool",
  },
};

/** Every signal, in the order the schema declares them. The form's order. */
export const signalList: readonly SignalDescription[] = signals.map((id) => signalDescriptions[id]);

/**
 * The selected signals as a prompt reads them, one per line.
 *
 * Empty means the user stated no preference, and both prompts are told that in
 * the same words. They then do different things with it — the generator writes
 * for every kind of post, the classifier stops treating any one kind as
 * expected — and each says so where it says it.
 */
export function describeSignals(selected: readonly Signal[]): string {
  if (selected.length === 0) return "none stated";

  return selected
    .map((id) => {
      const description = signalDescriptions[id];
      return description ? `- ${description.id}: ${description.describes}` : `- ${id}`;
    })
    .join("\n");
}
