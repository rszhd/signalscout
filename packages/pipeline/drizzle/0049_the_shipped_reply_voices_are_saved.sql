--> US-065's presets, saved rather than offered, for accounts that already
--> exist. New accounts get them from `user.create.after`; this is the same
--> five rows for everybody who registered before that hook did it.
-->
--> **A snapshot, and it will drift.** The words below are a copy of
--> `ai/reply-voices.ts` as it read the day this migration was written. A
--> migration cannot import TypeScript, and rewriting old rows to follow the
--> module later would overwrite whatever a person has since edited. The
--> module is the source; this file is history.
-->
--> A name already taken is left alone, so an instance where somebody wrote
--> their own "Short comment" keeps their words.
INSERT INTO "reply_prompts" ("user_id", "name", "instruction")
SELECT "u"."id", "preset"."name", "preset"."instruction"
  FROM "users" AS "u"
 CROSS JOIN (VALUES
  ('Answer first', 'Answer the question in the first sentence. Give the specific thing you
would tell a friend — a method, a trade-off, a number — not a summary of
the problem they already described.

Keep it to three or four sentences. Do not restate their question back to
them, and do not open with praise.'),
  ('Reddit regular', 'Write the way a regular in this subreddit writes: lower case is fine, no
marketing words, no em dashes stacked into a pitch. Name what you would
actually do, including the boring option.

If you mention a tool at all, mention it the way somebody lists what they
use — one clause, alongside the alternatives they are already weighing.
If the question does not call for a tool, do not name one.'),
  ('One good question', 'Answer briefly, then end with exactly one question that is genuinely
worth answering — something specific about their setup that would change
what you would advise.

Never ask a question whose real purpose is to start a sales conversation.
''What are you using now?'' is fine when the answer would change your
advice, and hollow when it would not.'),
  ('Technical detail', 'Be concrete and technical. Name the mechanism, the setting, the failure
mode — the specific detail somebody could act on this afternoon.

Avoid the register of a thought-leadership post: no opening line designed
to be quotable, no list of three principles, no closing summary. If you
cannot say something specific, say the one thing you would check first.'),
  ('Short comment', 'One or two sentences, and under about forty words. Plain, direct, no
greeting and no sign-off.

Match the register of a comment section rather than a forum post. If the
useful answer does not fit in two sentences, give the single most useful
part of it and stop.')
) AS "preset"("name", "instruction")
    ON CONFLICT DO NOTHING;
