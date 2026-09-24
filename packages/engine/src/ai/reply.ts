/**
 * Draft a reply to one match, for a person to edit and post themselves.
 *
 * US-040. **This product never posts.** The draft ends at a string: no account
 * credential, no write scope.
 *
 * **The voice is the whole of the guidance.** US-405. This file says what is
 * true — a person will edit and post this, what they sell, and the post — and
 * nothing about how a reply should sound, what it may say about the product,
 * or what it must never do. Those are rules, and the owner decided every rule
 * belongs in the voice a person can read and edit: the shipped voices in
 * `reply-voices.ts` carry the ones this file used to fix, and a person who
 * deletes one has decided to. A draft with no voice gets no rules at all.
 */
import { z } from "zod";
import { describeSignals } from "../signals.js";
import type { MonitorProfile, PostForClassification } from "./prompt.js";

/**
 * What a draft is: the reply, and what the model was unsure of.
 *
 * `uncertainties` is a separate field, and the shipped voices also ask for
 * the doubt inside the draft. The list is for the screen to show; the note in
 * the draft is what a person sees while they edit, which is the moment the
 * warning has to arrive.
 */
export const draftSchema = z.object({
  reply: z
    .string()
    .min(1)
    .describe("The reply, ready for a person to edit. Plain text, no markdown headings."),
  uncertainties: z
    .array(z.string())
    .describe(
      "What you could not tell from the post or the product description, and " +
        "which the person must check before posting. Empty if there is nothing.",
    ),
});

export type Draft = z.infer<typeof draftSchema>;

/** The project's voice, when it has set one. */
export interface ReplyVoice {
  /** What the person saved. Empty means they have not set one. */
  readonly instruction: string;
}

export function buildReplySystemPrompt(monitor: MonitorProfile, voice?: ReplyVoice): string {
  const instruction = voice?.instruction.trim() ?? "";

  return [
    "You draft a reply to a social media post. A person will read it, edit it " +
      "and post it themselves.",
    "",
    "The person you are writing for sells this:",
    `Product: ${monitor.product}`,
    `Ideal customer: ${monitor.idealCustomer}`,
    `Problem it solves: ${monitor.problem}`,
    `Signals they care about: ${describeSignals(monitor.signals)}`,
    ...(instruction ? ["", "How to write this reply:", instruction] : []),
  ].join("\n");
}

/**
 * The post being answered, and the thread above it when there is one.
 *
 * The same shape the classifier reads, and for the same reason: on a reply,
 * "we hit this too, what did you end up using?" names no product and no
 * problem, and a draft written without the thread answers the wrong person.
 */
export function buildReplyUserPrompt(post: PostForClassification): string {
  const lines: string[] = [];

  if (post.thread) {
    lines.push("The thread this sits in, for context only — you are not answering these:");
    if (post.thread.postTitle) lines.push(`Original post title: ${post.thread.postTitle}`);
    if (post.thread.postExcerpt) lines.push(`Original post: ${post.thread.postExcerpt}`);
    if (post.thread.parentReplyExcerpt) {
      lines.push(`The reply above this one: ${post.thread.parentReplyExcerpt}`);
    }
    lines.push("");
    lines.push("Answer this person:");
  } else {
    lines.push("Answer this person:");
  }

  lines.push(`Where: ${post.source}${post.channel ? ` (${post.channel})` : ""}`);
  if (post.title) lines.push(`Title: ${post.title}`);
  lines.push(`What they wrote: ${post.excerpt}`);

  return lines.join("\n");
}

export const draftSchemaName = "draft_reply";

export const draftSchemaDescription =
  "A reply for a person to edit and post themselves, and what you were unsure of.";
