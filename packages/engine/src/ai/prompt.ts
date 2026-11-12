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

import { describeSignals } from "../signals.js";
import type { Signal } from "../vocabulary.js";

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
  /**
   * The thread above this item, when it is a reply. US-020.
   *
   * Absent on a post. Present on a reply, and then it is not decoration: "we
   * hit this too, what did you end up using?" names no product and no problem,
   * and a model given only those words scores noise. The prompt says plainly
   * that the thread is context and that the reply's own author is the person
   * being judged — without that line the model scores whoever wrote the post,
   * and every reply under a good post becomes a match.
   */
  readonly thread?: ThreadContext;
}

/** What sits above a reply: the post, and the reply it answers. */
export interface ThreadContext {
  readonly postTitle?: string | null;
  /** The parent post's body, already shortened by the caller. */
  readonly postExcerpt?: string | null;
  /**
   * The reply directly above this one, when there is one.
   *
   * Two levels and no more. A thread is unbounded in depth and every level is
   * billed as input tokens on every call, and two is enough for "same here" to
   * mean something.
   */
  readonly parentReplyExcerpt?: string | null;
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
    "- icpFit: does the author look like the ideal customer above? When the",
    "  ideal customer is in one country, region or city, an author who shows",
    "  they are elsewhere (another country, its currency, its tax office, its",
    "  software) is not the ideal customer: 10 or less. Local signs, such as",
    "  the place's subreddit, language or currency, count for it. When the",
    "  post does not say where the author is, judge on the rest, unless the",
    "  product is delivered in person (below): then 10 or less.",
    "- intent: does the author want a product, tool or service of this kind",
    "  now? Asking what others use, or for one to be recommended, is strong",
    "  intent. A complaint about the problem with no question is partial",
    "  intent. Asking for advice, opinions, help with a life or career choice,",
    "  or support is not intent for a product, and neither is venting, telling",
    "  a story, or showing one's own project. Praise is not intent.",
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
    "",
    "DOES THE PRODUCT FIT A HELPFUL REPLY",
    "First write asks: what the author is asking for or needs, in one short",
    "sentence.",
    "Then answer productFit: can the seller write a helpful reply to this post",
    "where this product is the natural next step? Answer yes when the author asks",
    "for this kind of product, or when useful advice on their problem leads",
    "naturally to using or buying this product. Answer no when the advice would",
    "lead to no sale, when the author needs a different kind of tool or service,",
    "or when the author asks for nothing and has no problem to solve. Sharing a",
    "topic, an audience or a channel with the post is not enough.",
    "Judge the problem behind the question, not its words. People who need a",
    "product often ask for tips, advice or strategies and never mention a tool.",
    '"They did not ask for a tool" or "they did not name this product" is never',
    "a reason to answer no. Ask only: would using this product help with the",
    "problem they describe? The strict rules above are for the scores, not for",
    "this question. A rant or a story that wants no help is still a no. A job ad",
    "or a hiring post is a no, unless the product is itself a hiring product.",
    "A product delivered in person, where the seller or the customer must",
    "travel to the other (cleaning, repairs, a clinic, a caterer, a shop with no",
    "delivery), helps only an author in the place it serves. When the product",
    "names that place, answer no unless the post shows the author is there:",
    "the place or a town in it, its subreddit, its language, its currency. A",
    "post that does not say where the author is, is a no for such a product. A",
    "product used online or sent by post is not delivered in person: for it, an",
    "author who shows they are elsewhere is a no, and a post that does not say",
    "where the author is can still be a yes.",
    "Then write nextStep: the product's place in that reply, in one short",
    "sentence, or an empty string for no.",
  ].join("\n");
}

export function buildUserPrompt(post: PostForClassification): string {
  const thread = post.thread;

  if (!thread) {
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

  /**
   * A reply, with the thread above it and a sentence saying what to do with it.
   *
   * The order is deliberate: context first, then the instruction, then the
   * words being judged. The instruction sits between them so it cannot be read
   * as part of either, and the reply comes last because a model weighs the end
   * of a prompt most.
   */
  return [
    `Source: ${post.source}${post.channel ? ` (${post.channel})` : ""}`,
    `Posted: ${post.postedAt.toISOString()}`,
    "",
    "THREAD, FOR CONTEXT ONLY",
    thread.postTitle ? `The post says: ${thread.postTitle}` : undefined,
    thread.postExcerpt ? thread.postExcerpt : undefined,
    thread.parentReplyExcerpt
      ? `\nThe reply directly above says: ${thread.parentReplyExcerpt}`
      : undefined,
    "",
    "Judge the REPLY below, and the person who wrote it. Do not judge the",
    "person who wrote the post above: they are a different person and they are",
    "not on trial here. Most people replying under a post about this problem",
    "are answering it, and an expert giving advice is not a buyer.",
    "",
    "REPLY:",
    post.excerpt,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
