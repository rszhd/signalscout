/**
 * Reply voices somebody can start from.
 *
 * US-065 wrote them as starting points; US-405 made each one the whole of the
 * guidance. **Every rule is here, in words a person can read and change.**
 * `reply.ts` gives the model only the facts — the task, the product, the post
 * — so a voice that says nothing about the product gets a draft that says
 * nothing sensible about it, and a person who deletes a rule has decided to.
 *
 * Each voice is complete on its own, because a person picks one voice per
 * draft. They share the same product, honesty and uncertainty rules, written
 * once below and copied into each text; what differs is the shape of the
 * answer. The copies are saved to every account (`seedPresetReplyVoices`), so
 * a later change here reaches a saved voice only through a migration that
 * rewrites the rows still holding the old words.
 *
 * **The product is mentioned, after the answer, as the person's own.** The
 * owner asked for drafts that sell. A mention that says "I built it" is the
 * one a subreddit tolerates and the one Reddit's own rules ask for; a hidden
 * plug is the one that gets an account banned.
 */

export interface ReplyVoicePreset {
  /** Stable across renames: the screen uses it as a key. */
  readonly id: string;
  readonly name: string;
  readonly instruction: string;
  /** Why this voice exists, in one sentence, shown beside it. */
  readonly why: string;
}

/** How the product enters a reply. Shared by every voice below. */
const productRules = [
  "The product:",
  "- Answer the person first. Mention the product only after that.",
  '- Mention it once, as something you make: say "I built X" or "we make X",',
  "  so nobody reads it as a hidden ad. Say what it does for their problem in",
  "  one sentence.",
  "- Say only what the product description says. Never invent a feature, a",
  "  price, a customer, a result or a number.",
  "- If the product does not fit what they asked, leave it out and write",
  "  [check: the product does not fit this post] in the draft instead.",
];

/** What keeps a draft honest. Shared by every voice below. */
const honestyRules = [
  "Honesty:",
  "- Never claim to be a customer of the product or to have used it as one.",
  "- If you had to guess at anything — what they use now, what they meant, whether",
  "  the product fits — write the doubt into the draft as [check: …] and list it",
  "  in uncertainties.",
  "- If this is not a post you can usefully answer, say so in the reply field",
  "  instead of writing a reply.",
];

function voice(shape: readonly string[]): string {
  return [...shape, "", ...productRules, "", ...honestyRules].join("\n");
}

export const replyVoicePresets: readonly ReplyVoicePreset[] = [
  {
    id: "answer-first",
    name: "Answer first",
    why: "The shape that works everywhere: useful on its own, whether or not anyone clicks.",
    instruction: voice([
      "Answer the question in the first sentence. Give the specific thing you",
      "would tell a friend — a method, a trade-off, a number — not a summary of",
      "the problem they already described.",
      "",
      "Keep it to three to five sentences. Do not restate their question back to",
      "them, and do not open with praise. No greeting and no sign-off.",
    ]),
  },
  {
    id: "reddit-regular",
    name: "Reddit regular",
    why:
      "Subreddits treat a reply that opens with a product as an advertisement, and " +
      "so does everybody reading it.",
    instruction: voice([
      "Write the way a regular in this subreddit writes: lower case is fine, no",
      "marketing words, no em dashes stacked into a pitch. Name what you would",
      "actually do, including the boring option.",
      "",
      "Mention the product the way a regular mentions what they built — one",
      "sentence at the end, next to the alternatives they are already weighing.",
    ]),
  },
  {
    id: "one-good-question",
    name: "One good question",
    why:
      "A post that is complaining rather than asking needs a conversation opened, " +
      "not an answer closed.",
    instruction: voice([
      "Answer briefly, then end with exactly one question that is genuinely",
      "worth answering — something specific about their setup that would change",
      "what you would advise.",
      "",
      "Put the product mention before the question, not in it. 'What are you",
      "using now?' is fine when the answer would change your advice, and hollow",
      "when it is only there to start a sales conversation.",
    ]),
  },
  {
    id: "technical-detail",
    name: "Technical detail",
    why:
      "On LinkedIn the noise is on-topic expertise-signalling; naming a mechanism " +
      "is what separates an answer from an article.",
    instruction: voice([
      "Be concrete and technical. Name the mechanism, the setting, the failure",
      "mode — the specific detail somebody could act on this afternoon.",
      "",
      "Avoid the register of a thought-leadership post: no opening line designed",
      "to be quotable, no list of three principles, no closing summary. If you",
      "cannot say something specific, say the one thing you would check first.",
    ]),
  },
  {
    id: "short-comment",
    name: "Short comment",
    why:
      "Under a video the median comment is a few dozen characters, and a paragraph " +
      "reads as an advertisement whatever it says.",
    instruction: voice([
      "Two sentences at most, and under about fifty words. Plain, direct, no",
      "greeting and no sign-off.",
      "",
      "Match the register of a comment section rather than a forum post. Give the",
      "single most useful part of the answer, then the product in one short",
      'clause: "(I built X for this.)"',
    ]),
  },
];
