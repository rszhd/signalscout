/**
 * Reply voices somebody can start from.
 *
 * US-065. The voices page opened on an empty box and the words "Create your
 * first reply voice", which is the hardest screen in the product to answer: a
 * person who has never written one does not know what a good instruction looks
 * like, and the ones they guess at tend to ask for the thing the prompt
 * refuses.
 *
 * **These are starting points, not settings.** Choosing one fills the form; it
 * is saved, edited and deleted like any voice a person writes. Nothing here is
 * applied by default, and a deployment that ignores them behaves exactly as it
 * did.
 *
 * **Each one is grounded in something this repository measured**, not in
 * general advice about writing. The reason is in each `why`, and it is shown
 * on the screen — a preset a person does not understand is one they cannot
 * edit sensibly.
 *
 * None of them can override `ai/reply.ts`'s fixed rules, and none tries to.
 * They steer register, length and shape.
 */

export interface ReplyVoicePreset {
  /** Stable across renames: the screen uses it as a key. */
  readonly id: string;
  readonly name: string;
  readonly instruction: string;
  /** Why this voice exists, in one sentence, shown beside it. */
  readonly why: string;
}

export const replyVoicePresets: readonly ReplyVoicePreset[] = [
  {
    id: "answer-first",
    name: "Answer first",
    why: "The shape that works everywhere: useful on its own, whether or not anyone clicks.",
    instruction: [
      "Answer the question in the first sentence. Give the specific thing you",
      "would tell a friend — a method, a trade-off, a number — not a summary of",
      "the problem they already described.",
      "",
      "Keep it to three or four sentences. Do not restate their question back to",
      "them, and do not open with praise.",
    ].join("\n"),
  },
  {
    id: "reddit-regular",
    name: "Reddit regular",
    why:
      "Subreddits treat a reply that opens with a product as an advertisement, and " +
      "so does everybody reading it.",
    instruction: [
      "Write the way a regular in this subreddit writes: lower case is fine, no",
      "marketing words, no em dashes stacked into a pitch. Name what you would",
      "actually do, including the boring option.",
      "",
      "If you mention a tool at all, mention it the way somebody lists what they",
      "use — one clause, alongside the alternatives they are already weighing.",
      "If the question does not call for a tool, do not name one.",
    ].join("\n"),
  },
  {
    id: "one-good-question",
    name: "One good question",
    why:
      "A post that is complaining rather than asking needs a conversation opened, " +
      "not an answer closed.",
    instruction: [
      "Answer briefly, then end with exactly one question that is genuinely",
      "worth answering — something specific about their setup that would change",
      "what you would advise.",
      "",
      "Never ask a question whose real purpose is to start a sales conversation.",
      "'What are you using now?' is fine when the answer would change your",
      "advice, and hollow when it would not.",
    ].join("\n"),
  },
  {
    id: "technical-detail",
    name: "Technical detail",
    why:
      "On LinkedIn the noise is on-topic expertise-signalling; naming a mechanism " +
      "is what separates an answer from an article.",
    instruction: [
      "Be concrete and technical. Name the mechanism, the setting, the failure",
      "mode — the specific detail somebody could act on this afternoon.",
      "",
      "Avoid the register of a thought-leadership post: no opening line designed",
      "to be quotable, no list of three principles, no closing summary. If you",
      "cannot say something specific, say the one thing you would check first.",
    ].join("\n"),
  },
  {
    id: "short-comment",
    name: "Short comment",
    why:
      "Under a video the median comment is a few dozen characters, and a paragraph " +
      "reads as an advertisement whatever it says.",
    instruction: [
      "One or two sentences, and under about forty words. Plain, direct, no",
      "greeting and no sign-off.",
      "",
      "Match the register of a comment section rather than a forum post. If the",
      "useful answer does not fit in two sentences, give the single most useful",
      "part of it and stop.",
    ].join("\n"),
  },
];
