/**
 * One reply parser, for every SocialCrawl platform that has replies.
 *
 * The provider gives each of its comment endpoints the archetype
 * `CommentList` and points them at one schema, and US-020 asked whether that
 * shared name is a shared shape. It is. An X reply and a YouTube comment,
 * captured on 2026-09-06, carry the same nine field names:
 *
 *     author, engagement, flags, id, parent_id, post_id, published_at, text, url
 *
 * YouTube adds one more, `ext`, which is a bag of platform extras nothing here
 * reads. So this file is the parser and the connectors are the two things that
 * genuinely differ: which endpoint to call, and what to do when a field the
 * schema promises arrives empty.
 *
 * **The one real difference is `url`.** X gives a working link to the reply.
 * YouTube leaves it null on every comment, so its connector builds one. That
 * is a fallback rather than a repair: a reply nobody can open is a lead nobody
 * can act on.
 *
 * **US-049 found the shared shape is shared in name more than in fill.**
 * Instagram sends all nine field names and leaves three of them null on every
 * comment: `url`, `post_id` and `author.display_name`. Measured over 29
 * comments, against 129 from X, YouTube and TikTok that fill all three. So a
 * field this file requires must be one a platform actually sends, and the two
 * that are merely *usually* sent are read with a fallback rather than demanded.
 */
import type { CandidateReply } from "../../types.js";

export interface ReplyParseOptions {
  /** The post this reply hangs under, as its platform ids it. */
  readonly parentPostExternalId: string;
  /**
   * A link to the reply, for a platform that does not give one.
   *
   * Called only when the payload's own `url` is empty, so a provider that
   * starts filling the field in is believed rather than overridden.
   */
  readonly urlFor?: (externalId: string) => string;
  /** The subreddit, the channel, whatever the platform calls its container. */
  readonly channel?: string;
  /**
   * Where the provider put this comment, counting from zero across the walk.
   *
   * Passed in rather than counted here, because this function sees one comment
   * and the position is a property of the page it arrived on. US-048 says why
   * it is kept.
   */
  readonly position?: number;
}

/**
 * One comment from the wire to one `CandidateReply`, or nothing.
 *
 * Four fields are required and none is repaired: an id, a link, words and a
 * date. A comment missing any of them is not a comment we can store, show or
 * judge, and inventing the missing one would be inventing evidence.
 */
export function toCandidateReply(
  record: unknown,
  { parentPostExternalId, urlFor, channel, position }: ReplyParseOptions,
): CandidateReply | undefined {
  const item = objectOf(record);
  const comment = objectOf(item?.comment) ?? item;
  if (!comment) return undefined;

  const externalId = text(comment.id);
  const body = text(comment.text);
  const postedAt = dateOf(comment.published_at);
  const url = text(comment.url) ?? (externalId && urlFor ? urlFor(externalId) : undefined);

  if (!externalId || !url || !body || !postedAt) return undefined;

  /**
   * The comment must say it belongs to the post we asked about.
   *
   * **Found live on 2026-09-06, on X.** `/twitter/tweet/replies` was asked for
   * the replies under one post and returned a later post by the same account
   * on an unrelated subject — no `parent_id`, no leading @mention, and a
   * `post_id` that was not the one requested. The owner opened it and said it
   * was not a reply.
   *
   * Until this check, `parentPostExternalId` came from the *request* and the
   * payload's own `post_id` was never read, so whatever the endpoint returned
   * became a reply to the post we had asked about. That is worse than dropping
   * it. A comment reaches the classifier with its parent post as context — the
   * whole reason US-020 stores the link — so a wrong parent makes the model
   * judge real words against a conversation they were never part of, and the
   * inbox then shows "Replying to" above a post the person never saw.
   *
   * Three platforms send the field: 137 comments across the X, YouTube and
   * TikTok fixtures, all with `post_id`. **Instagram sends it null on every
   * comment** — 29 of 29, US-049 — so a comment that omits it is kept, because
   * absence is not disagreement. The consequence is worth naming rather than
   * leaving to be rediscovered: this check defends X, YouTube and TikTok, and
   * on Instagram it is inert. Nothing there stops the endpoint returning a
   * comment from another post.
   */
  const belongsTo = text(comment.post_id);

  if (belongsTo && belongsTo !== parentPostExternalId) return undefined;

  const author = objectOf(comment.author);
  const engagement = objectOf(comment.engagement);

  /**
   * The name to show, falling back to the handle.
   *
   * X, YouTube and TikTok fill `display_name` on every captured comment — 129
   * of 129. Instagram fills it on none of 29 and puts the identity in
   * `username` instead. Both name the same person, and a reply shown with no
   * author at all is a lead a person cannot judge, so the handle is used where
   * there is no display name. It is never used *instead* of one: a platform
   * that sends both keeps sending the name it chose.
   */
  const authorName = text(author?.display_name) ?? text(author?.username);

  /**
   * A reply to the post names the post; a reply to a reply names that reply.
   *
   * The distinction reaches the classifier's prompt, which is why it is read
   * rather than flattened away: "same here" means one thing under a question
   * and another under somebody else's answer.
   */
  const parent = text(comment.parent_id);
  const parentReply = parent && parent !== parentPostExternalId ? parent : undefined;

  const replies = engagement?.replies;

  return {
    externalId,
    url,
    text: body,
    postedAt,
    parentPostExternalId,
    ...(authorName ? { author: authorName } : {}),
    ...(channel ? { channel } : {}),
    ...(position === undefined ? {} : { threadPosition: position }),
    ...(parentReply ? { parentReplyExternalId: parentReply } : {}),
    ...(typeof replies === "number" && Number.isFinite(replies) && replies >= 0
      ? { replyCount: replies }
      : {}),
  };
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function dateOf(value: unknown): Date | undefined {
  const iso = text(value);
  if (!iso) return undefined;

  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
