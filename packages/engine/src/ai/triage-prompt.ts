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
 * **The answer carries no reasons.** That was expected to be where the saving
 * came from — output is priced several times input, and a classification
 * returns 95 output tokens — and on the first model we measured it was not.
 * `capture:triage` recorded about 113 output tokens per triage answer against
 * the classification's 95, because a reasoning model bills its own thinking as
 * output and a short answer does not shorten the thinking.
 *
 * So the reasons are still absent, for the two honest reasons left: there is
 * nothing to show a person, and a model asked to justify a one-word answer
 * writes more of them. The saving comes from the price gap between the two
 * models instead. `worker/runtime.ts` warns when there is no gap.
 *
 * **The prompt is told which way to fail.** A model asked to be strict will
 * be, and here strictness is the expensive direction: a dropped lead leaves no
 * row, no inbox entry and nothing for a person to notice. The classifier is
 * told to be strict for the opposite reason — it has a threshold behind it and
 * a person reading its output. So the two prompts pull different ways on
 * purpose, and this comment is here because that looks like an inconsistency
 * until you know it is a decision.
 *
 * **What it screens for is what the second reader scores.** US-221 moved the
 * question from "could this author be a person to reach?" to that plus "does
 * anything here say they want an answer?". Three of the classifier's five
 * dimensions are about the want, so the old question let a plausible person who
 * wants nothing through to a paid call that was always going to score low.
 *
 * That is a narrowing of `maybe`, not a removal of it. `maybe` now means doubt
 * about a want; the plain absence of one is a `no`. The captured verdicts are
 * why it was done that way rather than by dropping `maybe`: two of the three
 * surviving people asking answered `maybe`, and so did one worked example. A
 * rule that dropped `maybe` would delete real leads to save a handful of expert
 * comments, and a deleted lead is the mistake nobody can see.
 *
 * **A complaint counts as wanting something, and that line is here because the
 * first capture deleted a lead without it.** Told that wanting nothing is a
 * `no`, the model refused "Our Playwright tests break whenever the UI changes"
 * — PLAN.md's `mild-problem-signal`, which it scores 50. The classifier's own
 * prompt calls a complaint with no question partial intent. Triage has to leave
 * that judgement to it, so the prompt names the case rather than hoping.
 *
 * Measured on 2026-09-18 over the same 50 items on `gpt-5.6-luna`: 19 of 46
 * comments kept before, 13 after; people answering 6 kept, then 3 of 26; people
 * asking 3 of 4 either way; every worked example that is a lead still kept.
 * Output fell from 123 tokens an item to 80, and the cost per call did not
 * follow — 267 micro-dollars against 273, because the longer prompt bought the
 * shorter answer.
 */

import { describeSignals } from "../signals.js";
import type { Signal } from "../vocabulary.js";
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
    "WHAT THE SECOND READER ASKS",
    "It scores five things: whether the post is about this area, whether the",
    "author describes this problem in their own words, whether they look like",
    "the ideal customer, whether they are looking for a solution now, and",
    "whether it is happening now rather than remembered. Three of those five",
    "are about what the author wants. Judge the same thing: not only who this",
    "person is, but whether anything here says they want an answer.",
    "",
    "ANSWER ONE OF THREE",
    "- yes: this could be a person the product should reach, and something",
    "  here says they want an answer.",
    "- maybe: something here says they may want an answer, and you cannot tell",
    "  what it is worth.",
    "- no: this author describes no problem of their own and asks for nothing,",
    "  or the author could plainly never be a customer of this product.",
    "",
    "HOW TO CHOOSE",
    "Ask who the author is and what they want, not what the text is about.",
    "Under a post about this problem, most people are answering it — they name",
    "tools, give advice, argue. Those are experts, not buyers, and they are the",
    "largest group you will see. Refuse them. Refuse on the same ground anyone",
    "selling, announcing, teaching, joking or reporting news, and anyone",
    "describing somebody else's problem instead of their own.",
    "",
    "A person describing a problem of their own, or asking what others use, is",
    "the one to pass on. Being about the right subject is not enough on its",
    "own.",
    "",
    "NOTHING TO JUDGE IS A NO",
    "Some text carries no author to weigh at all. A moderator's notice or an",
    "automatic reply. A bare reaction — 'same', 'this', 'well said', 'I",
    "wouldn't be surprised' — that agrees with somebody else and says nothing",
    "of its own. A joke, an insult, a link with no words around it. Refuse all",
    "of those. They are not unclear; there is simply nobody in them.",
    "",
    "Being short is not what makes one of those a no. 'we hit this too, what",
    "did you end up using?' is nine words and it is the best kind of yes,",
    "because those nine words ask for something. Short and asking is a yes;",
    "short and only agreeing is a no.",
    "",
    "AN EXPLICIT ASK BEATS EVERY REFUSAL ABOVE",
    "If the author asks for a recommendation, asks what others use, or asks for",
    "help with something of their own, the answer is yes or maybe. Never no.",
    "It does not matter that the post also reviews products, names brands, tags",
    "accounts, reads like an advertisement or was clearly written to be seen.",
    "Look for the ask before you judge the packaging.",
    "",
    "'here is everything I have tried, I am still looking, any recommendations?'",
    "is the strongest kind of lead there is, and it arrives dressed as a product",
    "review more often than not. Refusing one of those because the post looks",
    "like content is the mistake this stage cannot take back.",
    "",
    "A PERSON ASKING FOR SOMETHING ELSE IS A NO",
    "Asking is not enough on its own either. Read what they want against the",
    "product above. Somebody asking for a tool this product does not make, or",
    "for a platform it does not cover, could never be its customer, however",
    "plainly they are asking and however close the subject sounds.",
    "",
    "A complaint counts as wanting something. 'our tests break whenever the UI",
    "changes' asks for nothing and names no tool to buy, and it is still a",
    "person living with this problem today. Never refuse one of those. The",
    "second reader weighs how much they want an answer; you only say that they",
    "might.",
    "",
    "MAYBE IS FOR A PERSON WHO MIGHT WANT SOMETHING",
    "The two mistakes do not cost the same. A wrong 'yes' costs one more call",
    "and lands on a page a person can read and dismiss. A wrong 'no' deletes",
    "the lead: nothing is stored, nothing is shown, and nobody can tell it",
    "happened. So when a person may want something and you cannot tell how",
    "much, answer maybe and let the second reader decide.",
    "",
    "That is doubt about a want. It is not doubt about everything: a person who",
    "plainly wants nothing is a 'no', however little else you can tell about",
    "them.",
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
