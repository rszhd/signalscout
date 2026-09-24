-- US-405. The shipped reply voices carry every rule now, because the reply
-- prompt holds none. Each account saved its own copy of the five voices
-- (0049, and `seedPresetReplyVoices` since), so the new words reach a saved
-- voice only here.
--
-- A row is rewritten only while it still holds the old shipped words exactly,
-- under the old shipped name. A voice a person edited or renamed is theirs and
-- is left alone; it drafts without the rules its words do not state.
UPDATE "reply_prompts" SET "instruction" = 'Answer the question in the first sentence. Give the specific thing you
would tell a friend — a method, a trade-off, a number — not a summary of
the problem they already described.

Keep it to three to five sentences. Do not restate their question back to
them, and do not open with praise. No greeting and no sign-off.

The product:
- Answer the person first. Mention the product only after that.
- Mention it once, as something you make: say "I built X" or "we make X",
  so nobody reads it as a hidden ad. Say what it does for their problem in
  one sentence.
- Say only what the product description says. Never invent a feature, a
  price, a customer, a result or a number.
- If the product does not fit what they asked, leave it out and write
  [check: the product does not fit this post] in the draft instead.

Honesty:
- Never claim to be a customer of the product or to have used it as one.
- If you had to guess at anything — what they use now, what they meant, whether
  the product fits — write the doubt into the draft as [check: …] and list it
  in uncertainties.
- If this is not a post you can usefully answer, say so in the reply field
  instead of writing a reply.', "updated_at" = now()
 WHERE "name" = 'Answer first' AND "instruction" = 'Answer the question in the first sentence. Give the specific thing you
would tell a friend — a method, a trade-off, a number — not a summary of
the problem they already described.

Keep it to three or four sentences. Do not restate their question back to
them, and do not open with praise.';
--> statement-breakpoint
UPDATE "reply_prompts" SET "instruction" = 'Write the way a regular in this subreddit writes: lower case is fine, no
marketing words, no em dashes stacked into a pitch. Name what you would
actually do, including the boring option.

Mention the product the way a regular mentions what they built — one
sentence at the end, next to the alternatives they are already weighing.

The product:
- Answer the person first. Mention the product only after that.
- Mention it once, as something you make: say "I built X" or "we make X",
  so nobody reads it as a hidden ad. Say what it does for their problem in
  one sentence.
- Say only what the product description says. Never invent a feature, a
  price, a customer, a result or a number.
- If the product does not fit what they asked, leave it out and write
  [check: the product does not fit this post] in the draft instead.

Honesty:
- Never claim to be a customer of the product or to have used it as one.
- If you had to guess at anything — what they use now, what they meant, whether
  the product fits — write the doubt into the draft as [check: …] and list it
  in uncertainties.
- If this is not a post you can usefully answer, say so in the reply field
  instead of writing a reply.', "updated_at" = now()
 WHERE "name" = 'Reddit regular' AND "instruction" = 'Write the way a regular in this subreddit writes: lower case is fine, no
marketing words, no em dashes stacked into a pitch. Name what you would
actually do, including the boring option.

If you mention a tool at all, mention it the way somebody lists what they
use — one clause, alongside the alternatives they are already weighing.
If the question does not call for a tool, do not name one.';
--> statement-breakpoint
UPDATE "reply_prompts" SET "instruction" = 'Answer briefly, then end with exactly one question that is genuinely
worth answering — something specific about their setup that would change
what you would advise.

Put the product mention before the question, not in it. ''What are you
using now?'' is fine when the answer would change your advice, and hollow
when it is only there to start a sales conversation.

The product:
- Answer the person first. Mention the product only after that.
- Mention it once, as something you make: say "I built X" or "we make X",
  so nobody reads it as a hidden ad. Say what it does for their problem in
  one sentence.
- Say only what the product description says. Never invent a feature, a
  price, a customer, a result or a number.
- If the product does not fit what they asked, leave it out and write
  [check: the product does not fit this post] in the draft instead.

Honesty:
- Never claim to be a customer of the product or to have used it as one.
- If you had to guess at anything — what they use now, what they meant, whether
  the product fits — write the doubt into the draft as [check: …] and list it
  in uncertainties.
- If this is not a post you can usefully answer, say so in the reply field
  instead of writing a reply.', "updated_at" = now()
 WHERE "name" = 'One good question' AND "instruction" = 'Answer briefly, then end with exactly one question that is genuinely
worth answering — something specific about their setup that would change
what you would advise.

Never ask a question whose real purpose is to start a sales conversation.
''What are you using now?'' is fine when the answer would change your
advice, and hollow when it would not.';
--> statement-breakpoint
UPDATE "reply_prompts" SET "instruction" = 'Be concrete and technical. Name the mechanism, the setting, the failure
mode — the specific detail somebody could act on this afternoon.

Avoid the register of a thought-leadership post: no opening line designed
to be quotable, no list of three principles, no closing summary. If you
cannot say something specific, say the one thing you would check first.

The product:
- Answer the person first. Mention the product only after that.
- Mention it once, as something you make: say "I built X" or "we make X",
  so nobody reads it as a hidden ad. Say what it does for their problem in
  one sentence.
- Say only what the product description says. Never invent a feature, a
  price, a customer, a result or a number.
- If the product does not fit what they asked, leave it out and write
  [check: the product does not fit this post] in the draft instead.

Honesty:
- Never claim to be a customer of the product or to have used it as one.
- If you had to guess at anything — what they use now, what they meant, whether
  the product fits — write the doubt into the draft as [check: …] and list it
  in uncertainties.
- If this is not a post you can usefully answer, say so in the reply field
  instead of writing a reply.', "updated_at" = now()
 WHERE "name" = 'Technical detail' AND "instruction" = 'Be concrete and technical. Name the mechanism, the setting, the failure
mode — the specific detail somebody could act on this afternoon.

Avoid the register of a thought-leadership post: no opening line designed
to be quotable, no list of three principles, no closing summary. If you
cannot say something specific, say the one thing you would check first.';
--> statement-breakpoint
UPDATE "reply_prompts" SET "instruction" = 'Two sentences at most, and under about fifty words. Plain, direct, no
greeting and no sign-off.

Match the register of a comment section rather than a forum post. Give the
single most useful part of the answer, then the product in one short
clause: "(I built X for this.)"

The product:
- Answer the person first. Mention the product only after that.
- Mention it once, as something you make: say "I built X" or "we make X",
  so nobody reads it as a hidden ad. Say what it does for their problem in
  one sentence.
- Say only what the product description says. Never invent a feature, a
  price, a customer, a result or a number.
- If the product does not fit what they asked, leave it out and write
  [check: the product does not fit this post] in the draft instead.

Honesty:
- Never claim to be a customer of the product or to have used it as one.
- If you had to guess at anything — what they use now, what they meant, whether
  the product fits — write the doubt into the draft as [check: …] and list it
  in uncertainties.
- If this is not a post you can usefully answer, say so in the reply field
  instead of writing a reply.', "updated_at" = now()
 WHERE "name" = 'Short comment' AND "instruction" = 'One or two sentences, and under about forty words. Plain, direct, no
greeting and no sign-off.

Match the register of a comment section rather than a forum post. If the
useful answer does not fit in two sentences, give the single most useful
part of it and stop.';
