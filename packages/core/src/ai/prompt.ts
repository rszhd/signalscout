/**
 * The prompt the classifier sends, built from the monitor and one post.
 *
 * Decision, asked by the ticket and settled here: **the monitor's four answers
 * go into the system prompt whole.** The alternative was to summarise them
 * once when the monitor is created and send the summary. Whole wins for now
 * for two reasons. The answers are short — four form fields a person typed —
 * so the summary saves tens of tokens against a post that costs hundreds. And
 * a summary is a second model output that nothing checks: when a score is
 * wrong, "the summary dropped the part about small teams" is a failure nobody
 * can see from the match. Revisit it when a monitor holds more than a form,
 * not before.
 *
 * The system prompt holds only the monitor, and the user prompt holds only the
 * post. That split is what lets a provider cache the monitor half across every
 * post in one poll.
 */
import type { Signal } from "../db/schema.js";
import { describeSignals } from "../monitors/signals.js";

/** The four answers PLAN.md's monitor form asks for, as the classifier sees them. */
export interface MonitorProfile {
  readonly product: string;
  readonly idealCustomer: string;
  readonly problem: string;
  /** The signals the user ticked. Empty means "no preference stated". */
  readonly signals: readonly Signal[];
}

/** One post, as the classifier sees it. Not a row: no ids, no embedding. */
export interface PostForClassification {
  readonly source: string;
  /** The subreddit, where the source has one. */
  readonly channel?: string | null;
  readonly author?: string | null;
  readonly title?: string | null;
  readonly excerpt: string;
  readonly postedAt: Date;
}

export function buildSystemPrompt(monitor: MonitorProfile): string {
  return [
    "You read one public social media post and decide whether the person who",
    "wrote it might need the product below. You are not judging the post; you",
    "are judging whether a founder should read it today.",
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
    describeSignals(monitor.signals),
    "None stated means no kind of post is expected, not that every kind",
    "scores well. Judge the post on its own.",
    "",
    "HOW TO SCORE",
    "Score each dimension from 0 to 100.",
    "- relevance: is the post about this area at all?",
    "- problemFit: does the author describe this problem, in their own words?",
    "- icpFit: does the author look like the ideal customer above?",
    "- intent: is the author looking for a solution now? Praise is not intent.",
    "  A complaint with no question is partial intent. Asking what others use",
    "  is strong intent.",
    "- urgency: is this happening now, rather than remembered or hypothetical?",
    "",
    "Be strict. Most posts are not leads, and a high score on a post that is",
    "not a lead costs the reader more than a low score on one that is.",
    "",
    "REASONS",
    "Give two to five short claims about THIS post. Each one names something",
    "the post actually says: who the author is, what they are doing, what they",
    "asked for. Never restate a score. 'Intent is high' is not a reason;",
    "'asks which tools other small teams use' is.",
  ].join("\n");
}

export function buildUserPrompt(post: PostForClassification): string {
  return [
    `Source: ${post.source}${post.channel ? ` (${post.channel})` : ""}`,
    `Posted: ${post.postedAt.toISOString()}`,
    post.title ? `Title: ${post.title}` : undefined,
    "",
    "Post:",
    post.excerpt,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
