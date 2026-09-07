/**
 * Instagram, fetched through SocialCrawl. US-049.
 *
 * The sixth platform, added against PLAN.md's *Important rule* on the owner's
 * decision, and the fifth this one provider fetches on one key.
 *
 * Three things make it unlike its four siblings here, and each one was measured
 * on 2026-09-06 rather than read from the catalogue.
 *
 * **1. A search with no date window returns the last five years, newest first
 * nowhere.** Thirty reels for `skincare for acne scars` ran from December 2021
 * to April 2026, in relevance order, and the newest of the thirty was **five
 * months old**. A monitor polling for what was said since it last looked would
 * have paid a credit a poll to be handed nothing that passed its `since`, for
 * as long as it ran. The same query with `date_posted=last-month` returned
 * eight reels and **all eight were inside the window**.
 *
 * So this connector always sends a window, and that is the difference from
 * `linkedin.ts`, which sends none when `since` is absent or old and takes what
 * it is given. Here that is not a neutral choice, it is the broken one.
 *
 * **2. `has_more` is wrong, and following it is free.** Page one came back with
 * thirty reels, `has_more: true` and a cursor; the cursor returned **zero items
 * for zero credits**, with another `has_more: true` and another cursor. So the
 * walk ends on an empty page, not on the flag. `client.ts` holds the rest.
 *
 * **3. The comments are mostly not words, and the leads are all in the few
 * that are.** A live poll collected 89 comments: 56 were under ten characters
 * and the median was four. Twelve passed sixty characters, and **the two
 * highest-scoring matches of the run are the two longest comments in it** — 233
 * and 289 characters, scoring 90 and 77. The 90 is the highest any comment has
 * scored on any platform in this product.
 *
 * So this platform is not poor, it is *sparse*, and a median describes it
 * badly. What it is expensively is dear to read: a comment page is five credits
 * where TikTok's and YouTube's are one, so the same poll spent **$1.6317 with
 * the provider and $0.3336 with the model**. Every other platform here spends
 * more on the model than on the provider. Budget for the reading.
 *
 * A fourth difference is smaller and reaches the shared parser: Instagram sends
 * `url`, `post_id` and `author.display_name` **null on every comment**. The
 * link is built here, the name falls back to the handle in `comments.ts`, and
 * the missing `post_id` means BUG-007's defence is inert on this platform —
 * nothing here can tell that a comment belongs to another post.
 */
import { instagramPlatform } from "../../platforms.js";
import type {
  CandidatePost,
  CandidateReply,
  ConnectorDefinition,
  CredentialCheck,
  ReplyRequest,
  ReplyResult,
  SearchRequest,
  SearchResult,
  SocialSource,
  SourceCredentials,
  SourceQuery,
  SourceRuntime,
} from "../../types.js";
import type { EndpointProfile, Page } from "./client.js";
import {
  instagramCommentsProfile,
  instagramSearchProfile,
  SocialCrawlClient,
  SocialCrawlError,
} from "./client.js";
import { toCandidateReply } from "./comments.js";
import { socialCrawlProvider } from "./provider.js";

/** A search page is 30 reels, so two is more threads than a poll will open. */
const maxPagesPerInput = 2;

/** One SocialCrawl credit, in micro-dollars. The same pack as every platform. */
const creditMicros = 8118;

export const socialCrawlInstagram: ConnectorDefinition = {
  platform: instagramPlatform,
  provider: socialCrawlProvider,
  billableUnit: "credit",
  pricePerUnitMicros: creditMicros,
  /**
   * Thirty reels for one credit — the cheapest search this product makes.
   *
   * It describes the search half only, and on this platform that is the cheap
   * half: a comment page is five credits for fifteen comments, and the lead is
   * in the comments. A person reading this row should read
   * `replyPricePerUnitMicros` beside it.
   */
  postsPerUnit: 30,
  maxUnitsPerQueryPoll: maxPagesPerInput,
  canFetchReplies: true,
  /**
   * **Five credits, not one, and this is the field that stops a fivefold
   * overspend.**
   *
   * US-028 found the same shape on LinkedIn: where a request and a credit are
   * different numbers, a guard fed the wrong one lets a monitor spend five
   * times its cap before anything refuses it. A comment page here is 5 credits
   * against the search's 1, so the two prices are declared separately and the
   * connector reports what the provider says it charged.
   */
  replyPricePerUnitMicros: 5 * creditMicros,
  create: (runtime) => new SocialCrawlInstagramSource(runtime),
};

/**
 * The windows `date_posted` accepts, narrowest first.
 *
 * The catalogue lists exactly these five and nothing between them, so `since`
 * is served by the narrowest window that still covers it and cut exactly here.
 *
 * `last-year` is the floor rather than "send nothing", which is what makes this
 * different from LinkedIn's table. Sending nothing is a measured mistake on
 * this endpoint: it returns relevance-ranked posts from five years back. A
 * `since` older than a year, or absent, takes the widest window there is and
 * still gets a search ordered by something.
 */
const windows = [
  { value: "last-hour", covers: 60 * 60 * 1000 },
  { value: "last-day", covers: 24 * 60 * 60 * 1000 },
  { value: "last-week", covers: 7 * 24 * 60 * 60 * 1000 },
  { value: "last-month", covers: 31 * 24 * 60 * 60 * 1000 },
  { value: "last-year", covers: 366 * 24 * 60 * 60 * 1000 },
] as const;

/**
 * The floor, and the reason this connector has one where LinkedIn's does not.
 *
 * Named rather than taken from the end of the list, so that adding a window
 * cannot quietly move what a monitor with no `since` asks for.
 */
const widestWindow = "last-year";

/**
 * Where the caller is. One discovery mode: a keyword search over reels.
 *
 * Channel discovery is absent for the reason it is absent everywhere else — a
 * monitor exists to find a stranger describing a problem, and a named account
 * is not one. The hashtag search is absent for a second reason: it is five
 * times the price, and a hashtag is a label a publisher chose.
 */
interface Cursor {
  readonly index: number;
  readonly pages: number;
  readonly after?: string;
}

const cursorSeparator = "|";

function encodeCursor({ index, pages, after }: Cursor): string {
  return [index, pages, after ?? ""].join(cursorSeparator);
}

function decodeCursor(cursor: string): Cursor {
  const parts = cursor.split(cursorSeparator);
  const index = Number(parts[0]);
  const pages = Number(parts[1]);
  const after = parts.slice(2).join(cursorSeparator);

  if (
    parts.length < 3 ||
    !Number.isInteger(index) ||
    index < 0 ||
    !Number.isInteger(pages) ||
    pages < 0
  ) {
    throw new Error(`${instagramPlatform.id}: cursor "${cursor}" was not issued by this source.`);
  }

  return { index, pages, ...(after ? { after } : {}) };
}

export class SocialCrawlInstagramSource implements SocialSource {
  readonly platform = socialCrawlInstagram.platform;
  readonly provider = socialCrawlInstagram.provider;
  readonly billableUnit = socialCrawlInstagram.billableUnit;
  readonly pricePerUnitMicros = socialCrawlInstagram.pricePerUnitMicros;
  readonly maxUnitsPerQueryPoll = socialCrawlInstagram.maxUnitsPerQueryPoll;
  readonly canFetchReplies = socialCrawlInstagram.canFetchReplies;
  readonly replyPricePerUnitMicros = socialCrawlInstagram.replyPricePerUnitMicros;

  constructor(private readonly runtime: SourceRuntime) {}

  private client(credentials: SourceCredentials, profile: EndpointProfile): SocialCrawlClient {
    const apiKey = credentials.apiKey;
    if (!apiKey) {
      throw new SocialCrawlError("credentials", "No SocialCrawl API key was given.", 0);
    }
    return new SocialCrawlClient({ runtime: this.runtime, apiKey, profile });
  }

  async validateCredentials(credentials: SourceCredentials): Promise<CredentialCheck> {
    if (!credentials.apiKey) {
      return { valid: false, reason: "Enter your SocialCrawl API key." };
    }

    try {
      await this.client(credentials, instagramSearchProfile).probe();
    } catch (error) {
      if (error instanceof SocialCrawlError && error.kind === "credentials") {
        return { valid: false, reason: error.message };
      }
      throw error;
    }

    return { valid: true };
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    const start =
      request.cursor === undefined ? this.first(request.query) : decodeCursor(request.cursor);

    if (!start) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    const query = request.query.queries[start.index];

    // The cursor points past the end of what this monitor names, which happens
    // when its queries were edited between two polls. Finishing is safe: the
    // next poll starts again from the first query.
    if (query === undefined) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    let page: Page;

    try {
      page = await this.client(request.credentials, instagramSearchProfile).fetchPage(
        {
          query,
          date_posted: this.window(request.query.since),
          ...(start.after ? { cursor: start.after } : {}),
        },
        request.signal,
      );
    } catch (error) {
      // A rate limit is the one failure the caller can act on by waiting. This
      // branch has never been reached against the real provider.
      if (error instanceof SocialCrawlError && error.kind === "rateLimit") {
        return {
          posts: [],
          unitsConsumed: 0,
          next: {
            status: "wait",
            retryAfter: error.retryAfter ?? new Date(this.runtime.now().getTime() + 60_000),
            cursor: encodeCursor(start),
          },
        };
      }
      throw error;
    }

    const collected = page.records
      .map((record) => toCandidatePost(record))
      .filter((post): post is CandidatePost => post !== undefined);

    /**
     * The exact cut, over every row.
     *
     * `date_posted` narrows to a whole window and the narrowest is an hour, so
     * posts older than `since` arrive whether we asked for them or not.
     *
     * Every row is tested and the walk is never stopped at the first old one.
     * The ordering here is relevance, and the catalogue says it is not even
     * stable between calls — a captured page ran 2023, 2026, 2024, 2025, 2023.
     * X's "the page is older than `since`, stop paging" rule would throw away a
     * fresh reel sitting behind an old one, and it is deliberately absent, for
     * the second time after LinkedIn.
     */
    const wanted = collected.filter(
      (post) => !request.query.since || post.postedAt > request.query.since,
    );

    // Truncating costs nothing: the credits were spent on the request, not on
    // the posts. On a provider that bills per record it would waste all of it.
    const posts = request.limit === undefined ? wanted : wanted.slice(0, request.limit);

    return {
      posts,
      unitsConsumed: page.creditsUsed,
      next: this.nextAfter(request.query, start, page),
    };
  }

  /**
   * One page of the comments under one reel.
   *
   * `sort=recent` rather than the endpoint's own default of `top`, for two
   * measured reasons and one written one. The captured `recent` page arrived
   * strictly newest-first — 30th, 30th, 29th, 29th, 29th, 29th, 28th and on
   * down — where the `top` page ran 28th, 29th, 27th, 30th, 30th. The
   * catalogue warns that a `top` walk starts repeating comments once it pages
   * past the ranked head, and a repeated page here costs five credits. And
   * US-048 measured that leads sit deeper in a thread than a platform's own
   * engagement ranking puts them, because a question collects no likes.
   *
   * The date cut is still applied over every row rather than stopping the walk
   * at the first old comment. Fourteen comments on one thread is not enough to
   * bet a lead on an ordering claim, and three of this provider's completeness
   * claims have already been measured wrong.
   */
  async fetchReplies(request: ReplyRequest): Promise<ReplyResult> {
    const page = await this.client(request.credentials, instagramCommentsProfile).fetchPage(
      {
        url: request.postUrl,
        sort: "recent",
        ...(request.cursor ? { cursor: request.cursor } : {}),
      },
      request.signal,
    );

    const parsed = page.records
      .map((record, index) =>
        toCandidateReply(record, {
          parentPostExternalId: request.postExternalId,
          position: (request.positionOffset ?? 0) + index,
          /**
           * Instagram leaves `url` null on every comment, so one is built.
           *
           * The format is the provider's own, not ours: its `/v1/instagram/
           * comment` endpoint documents a comment permalink as
           * `https://www.instagram.com/p/{shortcode}/c/{commentId}/` and
           * accepts one as input. `commentLink()` holds the shape.
           *
           * **Nobody has opened one.** US-047 opened one comment link per
           * platform and found TikTok's broken — a format this repository had
           * invented, that survived a capture, two live polls and a code
           * comment admitting it was a guess, because nobody pressed it. This
           * one is better sourced than that was, and it is still unpressed. The
           * ticket carries the open box.
           */
          urlFor: (id) => commentLink(request.postUrl, id),
        }),
      )
      .filter((reply): reply is CandidateReply => reply !== undefined);

    const replies = request.since
      ? parsed.filter((reply) => reply.postedAt > (request.since as Date))
      : parsed;

    return {
      replies,
      itemsReturned: page.records.length,
      unitsConsumed: page.creditsUsed,
      next: page.cursor ? { status: "ready", cursor: page.cursor } : { status: "done" },
      /**
       * Partial while the provider offers another page, and it may over-report.
       *
       * It over-reports here more than elsewhere, because this endpoint's
       * `has_more` has been measured true beside an empty page. The safe
       * direction is unchanged: a thread wrongly called partial is read again,
       * and one wrongly called complete is never revisited.
       */
      partial: page.cursor !== undefined,
    };
  }

  private first(query: SourceQuery): Cursor | undefined {
    return query.queries.length > 0 ? { index: 0, pages: 0 } : undefined;
  }

  /**
   * The narrowest window that still covers everything the caller asked for.
   *
   * Narrower is cheaper in posts we throw away and never cheaper in credits —
   * the call costs one either way. Too narrow silently loses posts, so the rule
   * is to widen: a `since` of nine days back takes `last-month`.
   *
   * A `since` older than a year, or none at all, takes the widest window rather
   * than no window. That is this platform's own finding: with no window the
   * newest of thirty results was five months old.
   */
  private window(since: Date | undefined): string {
    if (!since) return widestWindow;

    const age = this.runtime.now().getTime() - since.getTime();

    return (windows.find((candidate) => age <= candidate.covers) ?? { value: widestWindow }).value;
  }

  private nextAfter(query: SourceQuery, at: Cursor, page: Page): SearchResult["next"] {
    const pages = at.pages + 1;

    /**
     * An empty page ends this query, whatever `has_more` says.
     *
     * Measured: page two came back with zero items, `page_size: 0`, zero
     * credits and `has_more: true` with a fresh cursor. Following that flag is
     * an endless walk over nothing.
     *
     * Ending the *walk* on an empty page is not the same as reading an empty
     * answer as "this query is finished for good", which US-006 measured to be
     * wrong on X. Nothing is remembered: the next poll starts this query again
     * at page one.
     */
    const exhausted = page.records.length === 0;

    if (!exhausted && page.cursor !== undefined && pages < maxPagesPerInput) {
      return { status: "ready", cursor: encodeCursor({ ...at, pages, after: page.cursor }) };
    }

    const nextIndex = at.index + 1;

    if (nextIndex < query.queries.length) {
      return { status: "ready", cursor: encodeCursor({ index: nextIndex, pages: 0 }) };
    }

    return { status: "done" };
  }
}

/**
 * The link to one comment, in the format the provider documents.
 *
 *     https://www.instagram.com/p/DPDwh4-CW8W/c/18047529779658999/
 *
 * `/v1/instagram/comment` describes this shape and accepts one as input, so it
 * is read off the provider rather than invented — which is the distinction
 * US-047 was written about. A search result is a `/reel/` URL and the permalink
 * form is `/p/`, so the shortcode is lifted out and the path rebuilt.
 *
 * A URL this function cannot read is returned unchanged with the comment id
 * appended in the same shape, because a link that is merely the post is more
 * use than no link at all — and `toCandidateReply` drops a comment with no URL.
 */
export function commentLink(postUrl: string, commentId: string): string {
  const shortcode = /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(postUrl)?.[1];

  if (!shortcode) return `${postUrl.replace(/\/+$/, "")}/c/${commentId}/`;

  return `https://www.instagram.com/p/${shortcode}/c/${commentId}/`;
}

/**
 * One reel to one `CandidatePost`.
 *
 * The same envelope the X, LinkedIn, YouTube, Reddit and TikTok connectors
 * read. What is Instagram's own is that **two upstream surfaces answer this one
 * endpoint** — the catalogue says a date-filtered search is served by a
 * different one, and the capture confirmed the two differ: the unfiltered
 * surface fills `engagement.views` and leaves `likes` null, the filtered one
 * does the opposite, and their `ext` bags carry different keys.
 *
 * Every field this function reads is filled on both. That is why it is safe to
 * have one parser, and it is checked rather than assumed: `instagram.test.ts`
 * replays a page from each surface.
 *
 * `author.display_name` is null on the unfiltered surface and filled on the
 * filtered one, so the handle is the fallback — the same rule `comments.ts`
 * applies to a comment.
 */
export function toCandidatePost(record: unknown): CandidatePost | undefined {
  const item = objectOf(record);
  const post = objectOf(item?.post) ?? item;
  if (!post) return undefined;

  const externalId = text(post.id);
  const url = text(post.url);
  const postedAt = dateOf(post.published_at);
  const caption = text(objectOf(post.content)?.text);

  // A reel with no caption carries no words at all. It is skipped rather than
  // stored empty: there is nothing for a model to read, and an empty excerpt
  // would buy a classification to score silence.
  if (!externalId || !url || !postedAt || !caption) return undefined;

  const author = objectOf(post.author);
  const engagement = objectOf(post.engagement);
  const comments = engagement?.comments;
  const authorName = text(author?.display_name) ?? text(author?.username);

  return {
    externalId,
    url,
    text: caption,
    postedAt,
    ...(authorName ? { author: authorName } : {}),
    ...(typeof comments === "number" && Number.isFinite(comments) && comments >= 0
      ? { replyCount: comments }
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
