/**
 * The prompt triage sends. One question, and deliberately not the
 * classifier's.
 *
 * `prompt.ts` asks a model to score five dimensions and justify them. Reusing
 * it here with fewer fields would have been the cheap way to write this file
 * and the expensive way to own it: the classifier's prompt would then serve
 * two callers, and every later edit for one would have to be checked against
 * the other. It is also the wrong prompt. Triage does not rank; it answers a
 * single yes-or-no question badly enough to be cheap and well enough to be
 * safe.
 *
 * **The answer carries no reasons, and that is where the saving is.** Output
 * tokens are priced about five times input tokens, so a classification's 95
 * output tokens cost more than its 680 input ones. One word instead of five
 * scores and four reasons is most of the difference, whatever model runs it.
 *
 * **The prompt is told which way to fail.** A model asked to be strict will
 * be, and here strictness is the expensive direction: a dropped lead leaves no
 * row, no inbox entry and nothing for a person to notice. The classifier is
 * told to be strict for the opposite reason — it has a threshold behind it and
 * a person reading its output. So the two prompts pull different ways on
 * purpose, and this comment is here because that looks like an inconsistency
 * until you know it is a decision.
 */
import type { Signal } from "../db/schema.js";
import { describeSignals } from "../monitors/signals.js";
import type { MonitorProfile } from "./prompt.js";

export type { MonitorProfile } from "./prompt.js";

/**
 * One item, as triage sees it. Narrower than `PostForClassification`, and
 * narrower on purpose.
 *
 * The classifier is given a date and an author because it weighs urgency and
 * judges who is writing. Triage weighs neither: it asks whether this could be
 * a person to reach, and a timestamp cannot answer that. Taking the wider type
 * would make the pre-filter select two columns it never reads, and would
 * invite a later edit to put the date in the prompt, where it would cost
 * tokens on every item and decide nothing.
 */
export interface ItemForTriage {
  readonly source: string;
  /** The subreddit, where the platform has one. */
  readonly channel?: string | null;
  readonly title?: string | null;
  readonly excerpt: string;
}

/** What triage may answer. Only `no` drops; `maybe` and `yes` both go on. */
export const triageVerdicts = ["no", "maybe", "yes"] as const;
export type TriageVerdict = (typeof triageVerdicts)[number];

export function buildTriageSystemPrompt(monitor: MonitorProfile): string {
  return [
    "You are the first of two readers. You see one public post or comment and",
    "decide only whether the second reader — a slower and more careful model —",
    "should spend its time on it. You do not score it and you do not explain.",
    "",
    "THE PRODUCT",
    monitor.product,
    "",
    "THE IDEAL CUSTOMER",
    monitor.idealCustomer,
    "",
    "THE PROBLEM IT SOLVES",
    monitor.problem,
    "",
    "SIGNALS THE USER ASKED FOR",
    describeSignals(monitor.signals satisfies readonly Signal[]),
    "",
    "ANSWER ONE OF THREE",
    "- yes: the author could plausibly be a person this product should reach.",
    "- maybe: you cannot tell from what is here.",
    "- no: the author plainly could not be, whatever the second reader thinks.",
    "",
    "HOW TO CHOOSE",
    "Ask who the author is, not what the text is about. Under a post about",
    "this problem, most people are answering it — they name tools, give",
    "advice, argue. Those are experts, not buyers, and they are the largest",
    "group you will see. A person describing a problem of their own, or asking",
    "what others use, is the one worth passing on.",
    "",
    "Being about the right subject is not enough on its own, and being short",
    "is not a reason to refuse. 'we hit this too, what did you end up using?'",
    "is nine words and it is the best kind of yes.",
    "",
    "WHEN YOU ARE UNSURE, ANSWER MAYBE",
    "The two mistakes do not cost the same. A wrong 'yes' costs one more call",
    "and lands on a page a person can read and dismiss. A wrong 'no' deletes",
    "the lead: nothing is stored, nothing is shown, and nobody can tell it",
    "happened. Refuse only what is plainly not a person, and pass on the rest.",
  ].join("\n");
}

export function buildTriageUserPrompt(post: ItemForTriage): string {
  return [
    `Source: ${post.source}${post.channel ? ` (${post.channel})` : ""}`,
    post.title ? `Title: ${post.title}` : undefined,
    "",
    post.excerpt,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
