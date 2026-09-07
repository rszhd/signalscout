/**
 * Draft a reply to one match, for a person to edit and post themselves.
 *
 * US-040. **This product never posts.** PLAN.md puts social publishing on the
 * "what we are NOT building" list, and the owner drew the same line unprompted
 * when asking for this: the user posts it themselves. So this file ends at a
 * string. It holds no account credential, it has no write scope, and it is the
 * half that works on every platform whether or not a posting credential exists.
 *
 * **The failure to design against is not a bad draft. It is a plausible one.**
 * A draft that reads well and gets a fact wrong is worse than one that reads
 * badly, because a person will post the first and fix the second. Two things
 * follow, and both are in the prompt rather than in a tooltip: the model is
 * told to say what it is unsure of *inside the draft*, and it is told never to
 * invent a detail about the product it was not given.
 *
 * **A model told only to "write a reply" writes a landing page.** The matches
 * this product finds are people asking what others use. A reply that opens
 * with the product is an advertisement, and it will be treated as one by the
 * subreddit, by the commenter and by everyone reading. So the prompt says what
 * a good reply is here, in those words — the same way `prompt.ts` says an
 * expert giving advice is not a buyer.
 */
import { z } from "zod";
import { describeSignals } from "../monitors/signals.js";
import type { MonitorProfile, PostForClassification } from "./prompt.js";

/**
 * What a draft is: the reply, and what the model was unsure of.
 *
 * `uncertainties` is a separate field *and* the prompt asks for the doubt
 * inside the draft. That is deliberate duplication: the list is for the screen
 * to show, and the sentence in the draft is what a person sees while they are
 * editing — which is the moment the warning has to arrive.
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

/**
 * The rules an instruction may not override, said to the model in its own
 * words.
 *
 * A saved instruction is a preference and not a licence. "Always open by
 * naming our product" is exactly what this prompt exists to prevent, and a
 * person who writes it should get a draft that still reads like a person
 * rather than one that reads like an advertisement. Saying which rules are
 * fixed is more honest than silently ignoring the instruction, and more useful
 * than obeying it.
 */
const fixedRules = [
  "Never open with the product. The first sentence answers the person.",
  "Mention the product once at most, and only where it is one option among " +
    "the ones the person is already weighing. If it does not fit, leave it out " +
    "entirely — a reply with no mention is a good reply.",
  "Never invent a fact about the product, a price, a feature, a customer or a " +
    "benchmark. You know only what the product description says.",
  "Never claim to have used the product, to work anywhere, or to be a customer.",
];

export function buildReplySystemPrompt(monitor: MonitorProfile, voice?: ReplyVoice): string {
  const instruction = voice?.instruction.trim() ?? "";

  return [
    "You draft a reply that a person will read, edit and post themselves. You " +
      "are not posting it and you are not writing marketing copy.",
    "",
    "The person you are writing for sells this:",
    `Product: ${monitor.product}`,
    `Ideal customer: ${monitor.idealCustomer}`,
    `Problem it solves: ${monitor.problem}`,
    `Signals they care about: ${describeSignals(monitor.signals)}`,
    "",
    "What a good reply is here:",
    "- It answers the question that was actually asked, usefully, as somebody " +
      "who knows the subject would answer it.",
    "- It is worth posting even to a reader who never clicks anything.",
    "- It sounds like one person talking to another. No greeting formula, no " +
      "sign-off, no bullet list unless the question is genuinely a list.",
    "- It is short. Most good replies are two to five sentences.",
    "",
    "Rules you always follow, whatever else you are told:",
    ...fixedRules.map((rule) => `- ${rule}`),
    "",
    // The doubt goes in the draft, not only in the field beside it. A person
    // editing sees the draft; that is where a warning has to be.
    "If you had to guess at anything — what they are already using, what they " +
      "mean by a word, whether the product even fits — write that doubt into " +
      "the draft as a short bracketed note like [check: …], and list it in " +
      "uncertainties. A note a person deletes costs nothing. A confident " +
      "sentence that is wrong costs them their reputation.",
    "",
    "If the post is not something this person can helpfully answer, say so in " +
      "the reply field instead of writing a reply. An honest refusal is more " +
      "use than a draft nobody should post.",
    ...(instruction
      ? [
          "",
          "The person has saved a preference for how their replies should " +
            "sound. Follow it where it does not conflict with the rules above; " +
            "where it does, follow the rules and let the rest of the " +
            "preference stand.",
          `Their preference: ${instruction}`,
        ]
      : []),
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
