/**
 * TikTok, fetched through SocialCrawl. US-044.
 *
 * The fifth platform, added against PLAN.md's *Important rule* on the owner's
 * decision, and the fourth this one provider fetches on one key.
 *
 * **A video is not a lead here, and the comments are only sometimes one.**
 * US-034 found that a YouTube search returns publishers rather than people, and
 * TikTok is the same: "I tried a bunch of budgeting apps so you don't have to"
 * is a creator. What US-044 measured underneath is the part that decides
 * whether this platform is worth polling, and it is not a property of TikTok —
 * it is a property of what people go to a particular comment section to do.
 *
 *     meal-planning video, 2,618 comments   median 16 characters
 *     school-exam video                     median 19 characters
 *     acne moisturiser, 1,165 comments      median 54, 22 of 49 over sixty
 *
 * Under a recipe people write "code?" and "and its called?". Under a skincare
 * product they write out their whole condition, because they have to in order
 * to get a useful answer — and the top comment on that video was a person
 * listing their fungal acne, redness, sensitive and oily skin and asking
 * whether the product suited them. That is a lead by any reading.
 *
 * So a monitor whose customers have something they must describe will find
 * people here. One selling to engineers will not, and `platforms.ts` says so
 * where a person choosing platforms can read it.
 *
 * **The words mean something else.** `flaky tests` returned dandruff and school
 * exams: on this platform *flaky* is flakes and *test* is an exam. That is why
 * the platform's query note says to prefer the words a person says out loud
 * over the words of a trade.
 *
 * **The comments are multilingual**, which nothing else here returns. One page
 * of 49 held French and Spanish at full length. Nothing in this connector cares
 * — a comment is text — but every prompt in this product is English, and that
 * is written down here because the classifier will meet it before anybody
 * plans for it.
 */
import { tikTokPlatform } from "../../platforms.js";
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
  SocialCrawlClient,
  SocialCrawlError,
  tikTokCommentsProfile,
  tikTokSearchProfile,
} from "./client.js";
import { toCandidateReply } from "./comments.js";
import { socialCrawlProvider } from "./provider.js";

/** A search page is 30 videos, so two is more threads than a poll will open. */
const maxPagesPerInput = 2;

export const socialCrawlTikTok: ConnectorDefinition = {
  platform: tikTokPlatform,
  provider: socialCrawlProvider,
  billableUnit: "request",
  /** The same credit as X, LinkedIn, YouTube and Reddit: one provider, one pack. */
  pricePerUnitMicros: 8118,
  /** A search page is 30 videos for one credit. Measured in US-044. */
  postsPerUnit: 30,
  maxUnitsPerQueryPoll: maxPagesPerInput,
  canFetchReplies: true,
  /** A comment page is one credit, the same as a search. Measured. */
  replyPricePerUnitMicros: 8118,
  create: (runtime) => new SocialCrawlTikTokSource(runtime),
};

/**
 * Where the caller is. One discovery mode: a keyword search.
 *
 * Channel discovery is absent for the reason it is absent everywhere else — a
 * monitor exists to find a stranger describing a problem, and a named account
 * is not one.
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
    throw new Error(`${tikTokPlatform.id}: cursor "${cursor}" was not issued by this source.`);
  }

  return { index, pages, ...(after ? { after } : {}) };
}

export class SocialCrawlTikTokSource implements SocialSource {
  readonly platform = socialCrawlTikTok.platform;
  readonly provider = socialCrawlTikTok.provider;
  readonly billableUnit = socialCrawlTikTok.billableUnit;
  readonly pricePerUnitMicros = socialCrawlTikTok.pricePerUnitMicros;
  readonly maxUnitsPerQueryPoll = socialCrawlTikTok.maxUnitsPerQueryPoll;
  readonly canFetchReplies = socialCrawlTikTok.canFetchReplies;
  readonly replyPricePerUnitMicros = socialCrawlTikTok.replyPricePerUnitMicros;

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
      await this.client(credentials, tikTokSearchProfile).probe();
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
      page = await this.client(request.credentials, tikTokSearchProfile).fetchPage(
        { query, ...(start.after ? { cursor: start.after } : {}) },
        request.signal,
      );
    } catch (error) {
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

    const wanted = collected.filter(
      (post) => !request.query.since || post.postedAt > request.query.since,
    );
    const posts = request.limit === undefined ? wanted : wanted.slice(0, request.limit);

    return {
      posts,
      unitsConsumed: page.creditsUsed,
      next: this.nextAfter(request.query, start, page),
    };
  }

  /**
   * One page of the comments under one video.
   *
   * The date cut is applied here because the provider offers none, and every
   * row is tested rather than the walk being stopped at the first old one:
   * this endpoint gives no ordering guarantee, so an old comment says nothing
   * about the next. Two of this provider's completeness flags have already been
   * measured wrong on other platforms.
   */
  async fetchReplies(request: ReplyRequest): Promise<ReplyResult> {
    const page = await this.client(request.credentials, tikTokCommentsProfile).fetchPage(
      {
        url: request.postUrl,
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
           * **`?cid=` is TikTok's own comment link, and it opens the comment.**
           *
           * TikTok leaves `url` null on every comment, so one is built. The
           * format is not ours: it is what TikTok puts in the notification a
           * person gets when somebody comments, and the owner recognised it
           * there on 2026-09-06. `commentLink()` holds the encoding.
           *
           * It replaces `?comment_id=`, which this connector invented on the
           * argument that it could only help — honoured, the reader lands on
           * the comment; ignored, the link is still the video. The owner
           * opened one and TikTok ignored it, which is the direction that
           * argument missed: a URL carrying a comment id reads as a deep link,
           * so a person presses it expecting the comment and gets the video
           * with no warning.
           *
           * The rule that produced both outcomes is the one already written
           * for fixtures. A URL format we invented is evidence about our own
           * string building and none about the platform. This one was read off
           * the platform and then opened, on a comment found by a poll rather
           * than by a notification.
           *
           * What is proven is a signed-in browser. Nobody has opened one
           * logged out.
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
       * The safe direction: a thread wrongly called partial is read again for
       * one credit, and one wrongly called complete is never revisited.
       */
      partial: page.cursor !== undefined,
    };
  }

  private first(query: SourceQuery): Cursor | undefined {
    return query.queries.length > 0 ? { index: 0, pages: 0 } : undefined;
  }

  private nextAfter(query: SourceQuery, at: Cursor, page: Page): SearchResult["next"] {
    const pages = at.pages + 1;

    if (page.cursor !== undefined && pages < maxPagesPerInput) {
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
 * One video to one `CandidatePost`.
 *
 * The same envelope the X, LinkedIn, YouTube and Reddit connectors read. What
 * is TikTok's own is what is missing: there is no title and no description, so
 * `content.text` is the caption and it is the only text a video carries. That
 * is why this platform's leads live in the comments rather than in the posts.
 */
/**
 * The link to one comment, in TikTok's own format.
 *
 *     https://www.tiktok.com/@user/video/7656532107921001759?cid=NzY3OTM5...
 *
 * `cid` is the comment's decimal id, base64 in the URL-safe alphabet, with the
 * padding removed. That is not a guess: it is the shape of the link TikTok
 * sends in a comment notification, and a link built this way from a comment
 * this product collected was opened on 2026-09-06 and landed on the comment.
 *
 * The id is used exactly as the provider gives it. It is a decimal string of
 * about nineteen digits, and it is not read as a number anywhere — a
 * nineteen-digit integer does not survive a double, and the last digits are
 * the ones that identify the comment.
 *
 * A query string already on the video URL is preserved, because a video URL
 * that arrived with one is still that video.
 */
export function commentLink(postUrl: string, commentId: string): string {
  const cid = Buffer.from(commentId, "utf8").toString("base64url");
  const separator = postUrl.includes("?") ? "&" : "?";

  return `${postUrl}${separator}cid=${cid}`;
}

export function toCandidatePost(record: unknown): CandidatePost | undefined {
  const item = objectOf(record);
  const post = objectOf(item?.post) ?? item;
  if (!post) return undefined;

  const externalId = text(post.id);
  const url = text(post.url);
  const postedAt = dateOf(post.published_at);
  const caption = text(objectOf(post.content)?.text);

  // A video with no caption carries no words at all. It is skipped rather than
  // stored empty: there is nothing for a model to read, and an empty excerpt
  // would buy a classification to score silence.
  if (!externalId || !url || !postedAt || !caption) return undefined;

  const author = objectOf(post.author);
  const engagement = objectOf(post.engagement);
  const comments = engagement?.comments;

  return {
    externalId,
    url,
    text: caption,
    postedAt,
    ...(text(author?.display_name) ? { author: text(author?.display_name) } : {}),
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
