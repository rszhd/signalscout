/**
 * The prompt triage sends: one yes-or-no question, deliberately not the
 * classifier's (`prompt.ts`), so an edit to one is never checked against the
 * other.
 *
 * Invariants:
 * - The answer carries no reasons. The saving is the price gap between the
 *   two models, not a shorter answer: a reasoning model bills its thinking.
 * - The prompt is told to fail toward keeping. A dropped lead leaves no row
 *   and nothing to notice; the classifier is told the opposite because a
 *   threshold and a person sit behind it.
 * - It screens for a want, not only a person (US-221). `maybe` means doubt
 *   about a want; plain absence of one is `no`. A complaint counts as a want,
 *   because the first capture deleted PLAN.md's `mild-problem-signal`
 *   without that line.
 *
 * The Logs of US-030, US-221 and US-229 hold the numbers behind each.
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

/**
 * The same question, put to a model that evaluates rather than converses.
 * US-230.
 *
 * **This is not `buildTriageSystemPrompt` in another shape, and the difference
 * is measured.** US-229 tried four translations over 227 real items:
 *
 * Sending the system prompt above as the Choice question's `instructions`
 * leaves the model near a coin flip. One plain lead answered `yes` at 0.44
 * against `no` at 0.40 and answered `no` on the next call. The API takes JSON
 * for `state` and `instructions`; 5,000 characters of prose written for a
 * system slot is not what it reads.
 *
 * Putting the monitor and the item in `state` as JSON, with the rule as short
 * `instructions`, is what works. The same lead answers `yes` at 0.94.
 *
 * **The question is US-221's older one, on purpose.** US-221 tightened it from
 * "could this author be a person to reach?" to that plus "does anything here
 * say they want an answer?". On the 46 labelled comments that tightening
 * helped. On posts it keeps 1 item in 227: a founder who writes that a launch
 * got no signups describes a live problem and asks nothing, and the tightened
 * rule refuses them. So this asks the older question and keeps the clause that
 * an explicit ask beats every refusal — dropping that clause alone cost two of
 * the six real leads in the sample, both posts that open by describing the
 * author's own product and ask for help at the end.
 *
 * Whether the two readers should ask one question or two is open, and US-229
 * is where it gets answered. Until then this rule lives beside the other and
 * neither is the default.
 */
export const triageEvaluationInstructions = {
  question:
    "You are the first of two readers. Decide only whether a slower, more careful model " +
    "should spend its time on this item. The question is whether this author could be a " +
    "person the product should reach. Judge who the author is and what they want, not what " +
    "the text is about.",
  refuse: [
    "Anyone selling, advertising or promoting their own product or content.",
    "Anyone describing somebody else's problem instead of their own.",
    "Text with no author to weigh: a moderator's notice, an automatic reply, a bare " +
      "reaction that only agrees, a joke, a link with no words around it.",
  ],
  anExplicitAskBeatsEveryRefusalAbove:
    "If the author asks for a recommendation, asks what others use, or asks for help with " +
    "something of their own, the answer is yes or maybe, never no. It does not matter that " +
    "the post also describes their own product or service, links to it, or reads like an " +
    "advertisement. Look for the ask before you judge the packaging.",
  butAskingForSomethingElseIsNo:
    "Read what they want against the product. Somebody asking for a tool this product does " +
    "not make, or for a platform it does not cover, could never be its customer, however " +
    "plainly they are asking.",
  keep:
    "A person describing a problem of their own, asking what others use, or saying what they " +
    "are building and what is not working. They do not have to ask a question. A complaint, " +
    "a launch with no signups, or a description of a difficulty is a person living with this " +
    "problem today.",
  theTwoMistakesDifferInCost:
    "A wrong yes costs one more call and lands on a page a person can dismiss. A wrong no " +
    "deletes the lead: nothing is stored, nothing is shown, and nobody can tell it happened. " +
    "When a person may want something and you cannot tell how much, answer maybe.",
} as const;

/**
 * The three verdicts as Choice options, worded from the prompt's own bullets.
 *
 * Copied rather than summarised, so that reading a disagreement later is
 * reading the product's rule and not a paraphrase of it.
 */
export const triageEvaluationCriteria: Readonly<Record<TriageVerdict, string>> = {
  no:
    "This author describes no problem of their own and asks for nothing, or the author " +
    "could plainly never be a customer of this product.",
  maybe: "Something here says they may want an answer, and you cannot tell what it is worth.",
  yes:
    "This could be a person the product should reach, and something here says they want " +
    "an answer.",
};

/** The monitor and the item as one shared state, which is what the API reads. */
export function buildTriageEvaluationState(
  monitor: MonitorProfile,
  post: ItemForTriage,
): Record<string, string | string[] | Record<string, string>> {
  return {
    theProduct: monitor.product,
    theIdealCustomer: monitor.idealCustomer,
    theProblemItSolves: monitor.problem,
    signalsTheUserAskedFor: [...(monitor.signals satisfies readonly Signal[])],
    item: {
      source: post.source,
      ...(post.channel ? { channel: post.channel } : {}),
      ...(post.title ? { title: post.title } : {}),
      text: post.excerpt,
    },
  };
}
