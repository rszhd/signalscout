/**
 * YouTube through ScrapeCreators. US-127.
 *
 * The second provider for a platform we already fetch, so nothing downstream
 * learns which one answered. Every shape below was captured from a live account
 * by `youtube-fixtures/capture.mjs` on 2026-09-11 and recorded in US-121.
 *
 * **The reason this connector exists is text, not price.** Twenty videos for
 * one credit is $0.094 a thousand against SocialCrawl's $0.180, which on its
 * own would be thin. What decides it is that `socialcrawl/youtube.ts` gives the
 * classifier a title — 68 characters at the median, the thinnest text of any
 * platform in this product — and this endpoint returns the description beside
 * it, 1,413 to 1,620 characters at the median, for the same one credit.
 *
 * Five measured facts shape everything below.
 *
 * 1. **`includeExtras=true` is not optional, and the second reason is worse
 *    than the first.** It carries the description. It also carries
 *    `publishDate`, which is the real timestamp — `publishedTime` looks like
 *    one and is computed by subtracting "3 weeks ago" from the moment of the
 *    call, so every video in one answer shares a time of day. A `since` cut
 *    made on it is wrong by up to a day, every poll, and nothing in the answer
 *    says so.
 * 2. **There is no date order and no way to ask for one.** `sortBy` takes
 *    `relevance` and `popular`. So `reddit.ts`'s third stopping rule — this
 *    page is all older than `since`, so stop — is absent here, as it is on
 *    LinkedIn. Relevance is a good ranking on this platform: the first page was
 *    on topic with no window at all, unlike TikTok's.
 * 3. **`uploadDate` narrows and it leaks.** `today` returned twelve videos,
 *    nine of them hours old and three of them two and three weeks old. It is
 *    worth sending — twelve results against twenty — and it is not a filter
 *    this connector may trust. The real cut is made here, against `publishDate`.
 * 4. **Nothing is mixed in.** The answer holds `videos`, `channels`,
 *    `playlists`, `shorts`, `shelves` and `lives`, each in its own array, so
 *    reading `videos` cannot store a channel by accident. `type=videos` is
 *    still sent, because a short is not a conversation.
 * 5. **A comment's date is arithmetic, and no parameter corrects it.** US-135
 *    captured a 419-comment thread on 2026-09-15: every comment on a page
 *    shares one time of day, `order=newest` put a two-year-old comment behind
 *    nineteen four-year-old ones, and `order=top` returned nineteen of the
 *    same twenty. So a reply here is kept with its date marked approximate,
 *    and the `since` cut is made at the precision of the relative text — "4
 *    years ago" is safely older than a thirty-day window and "3 weeks ago" is
 *    not. See `fetchReplies`.
 */

import { youTubePlatform } from "../../platforms.js";
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
import type { Page } from "./client.js";
import {
  endpoints,
  ScrapeCreatorsClient,
  ScrapeCreatorsError,
  youTubeCommentsShape,
  youTubeSearchShape,
} from "./client.js";
import { scrapeCreatorsProvider } from "./provider.js";

/** A search page is 20 videos, so two is more than a poll will read. */
const maxPagesPerInput = 2;

export const scrapeCreatorsYouTube: ConnectorDefinition = {
  platform: youTubePlatform,
  provider: scrapeCreatorsProvider,
  /** A request, at the same $1.88 per thousand every endpoint on this key costs. */
  billableUnit: "request",
  pricePerUnitMicros: 1880,
  /** Twenty videos for one credit, measured twice in US-121. */
  postsPerUnit: 20,
  discovery: ["keyword"],
  maxUnitsPerQueryPoll: maxPagesPerInput,
  /**
   * Comments, at the same credit a search costs, and with two limits the
   * connector states rather than hides. US-135.
   *
   * US-121 found one comment across twenty videos on its keyword and left this
   * off; US-135 found 419 under one video on another and turned it on, because
   * a monitor with a YouTube audience draws its questions from the thread and
   * the lent-keys plan fetches YouTube through this connector alone.
   *
   * The limits. A comment's date is computed from "4 years ago", so it is
   * stored approximate and cut only at that precision. And the page is ranked
   * rather than dated, so a thread re-opened because its count grew re-reads
   * mostly the same twenty; a new comment in a busy thread is reached by
   * paging, not by asking for it. `socialcrawl/youtube.ts` reads the same
   * platform with a real date and a newest-first walk, for an account that
   * holds that key.
   */
  canFetchReplies: true,
  create: (runtime) => new ScrapeCreatorsYouTubeSource(runtime),
};

/**
 * The windows this endpoint accepts, narrowest first.
 *
 * Read from the provider's OpenAPI document, which is free. There is nothing
 * between `today` and `this_week`, and nothing narrower than a day, so a
 * monitor polling hourly asks for a day and cuts the rest itself.
 */
const windows = [
  { value: "today", days: 1 },
  { value: "this_week", days: 7 },
  { value: "this_month", days: 31 },
  { value: "this_year", days: 366 },
] as const;

/**
 * The narrowest window that still covers everything the caller asked for, or
 * nothing at all.
 *
 * Returning nothing is a real answer here: this endpoint has no "all time"
 * value, so a monitor reaching further back than a year sends no window and
 * takes the unfiltered page.
 */
export function windowFor(since: Date | undefined, now: Date): string | undefined {
  if (!since) return undefined;

  const days = (now.getTime() - since.getTime()) / 86_400_000;
  return windows.find((window) => days <= window.days)?.value;
}

/** Where the caller is. One discovery mode: a keyword search. */
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
    throw new Error(`${youTubePlatform.id}: cursor "${cursor}" was not issued by this source.`);
  }

  return { index, pages, ...(after ? { after } : {}) };
}

export class ScrapeCreatorsYouTubeSource implements SocialSource {
  readonly platform = scrapeCreatorsYouTube.platform;
  readonly provider = scrapeCreatorsYouTube.provider;
  readonly billableUnit = scrapeCreatorsYouTube.billableUnit;
  readonly pricePerUnitMicros = scrapeCreatorsYouTube.pricePerUnitMicros;
  readonly maxUnitsPerQueryPoll = scrapeCreatorsYouTube.maxUnitsPerQueryPoll;
  readonly canFetchReplies = scrapeCreatorsYouTube.canFetchReplies;

  constructor(private readonly runtime: SourceRuntime) {}

  private client(credentials: SourceCredentials): ScrapeCreatorsClient {
    const apiKey = credentials.apiKey;
    if (!apiKey) {
      throw new ScrapeCreatorsError("credentials", "No ScrapeCreators API key was given.", 0);
    }
    return new ScrapeCreatorsClient({ runtime: this.runtime, apiKey });
  }

  async validateCredentials(credentials: SourceCredentials): Promise<CredentialCheck> {
    if (!credentials.apiKey) {
      return { valid: false, reason: "Enter your ScrapeCreators API key." };
    }

    try {
      await this.client(credentials).probe();
    } catch (error) {
      if (error instanceof ScrapeCreatorsError && error.kind === "credentials") {
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
    // when its queries were edited between two polls. Finishing is safe.
    if (query === undefined) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    const uploadDate = windowFor(request.query.since, this.runtime.now());

    let page: Page;

    try {
      page = await this.client(request.credentials).fetchPage(
        endpoints.youTubeSearch,
        {
          query,
          /** A short is not a conversation, and a channel is not a post. */
          type: "videos",
          /**
           * The description, and the only real timestamp this endpoint has.
           * Never omitted: without it a post is a title with a date that was
           * arithmetic on "3 weeks ago".
           */
          includeExtras: "true",
          ...(uploadDate ? { uploadDate } : {}),
          ...(start.after ? { continuationToken: start.after } : {}),
        },
        youTubeSearchShape,
        request.signal,
      );
    } catch (error) {
      if (error instanceof ScrapeCreatorsError && error.kind === "rateLimit") {
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
     * The cut this connector makes itself, because `uploadDate` leaks.
     *
     * A post whose date the provider itself calls approximate is kept: US-034
     * settled that dropping a video because the provider was vague loses a lead
     * nobody can tell was lost, and keeping it costs one model call.
     */
    const wanted = collected.filter(
      (post) =>
        !request.query.since || post.postedAtIsApproximate || post.postedAt > request.query.since,
    );

    const posts = request.limit === undefined ? wanted : wanted.slice(0, request.limit);

    return {
      posts,
      unitsConsumed: page.creditsCharged,
      next: this.nextAfter(request.query, start, page),
    };
  }

  /**
   * One page of the top-level comments under one video.
   *
   * The `since` cut is made here because the endpoint has no date parameter,
   * and it is made at the precision of the provider's relative text rather
   * than at the second, because the second is arithmetic. Every row is tested
   * and the walk is never stopped early: measured, the page is not in date
   * order, so an old comment says nothing about the next one.
   *
   * A comment's own replies are never bought. Each parent carries a
   * `repliesContinuationToken` that costs a credit to follow, and a page is
   * reported partial whenever any parent on it claims replies.
   */
  async fetchReplies(request: ReplyRequest): Promise<ReplyResult> {
    const page = await this.client(request.credentials).fetchPage(
      endpoints.youTubeComments,
      {
        url: request.postUrl,
        /**
         * Sent because it is what a monitor means, and not trusted: the
         * captured `newest` page and the captured `top` page share nineteen
         * of twenty ids, and neither is in date order.
         */
        order: "newest",
        ...(request.cursor ? { continuationToken: request.cursor } : {}),
      },
      youTubeCommentsShape,
      request.signal,
    );

    const replies = page.records
      .map((record, index) =>
        toCandidateReply(record, {
          parentPostExternalId: request.postExternalId,
          position: (request.positionOffset ?? 0) + index,
          postUrl: request.postUrl,
        }),
      )
      .filter((reply): reply is CandidateReply => reply !== undefined)
      .filter((reply) => !request.since || couldBeAfter(reply, request.since));

    return {
      replies,
      itemsReturned: page.records.length,
      unitsConsumed: page.creditsCharged,
      next: page.after ? { status: "ready", cursor: page.after } : { status: "done" },
      partial: hasUnreadReplies(page.records) || page.after !== undefined,
    };
  }

  /**
   * Where to go after this page.
   *
   * Two things end a query. The third that `reddit.ts` has cannot exist here:
   * the page is ranked by relevance, so a page of old videos says nothing about
   * the next one.
   */
  private nextAfter(query: SourceQuery, at: Cursor, page: Page): SearchResult["next"] {
    const pages = at.pages + 1;

    if (page.after && pages < maxPagesPerInput) {
      return { status: "ready", cursor: encodeCursor({ ...at, pages, after: page.after }) };
    }

    const onward = this.advance(query, at);
    return onward ? { status: "ready", cursor: encodeCursor(onward) } : { status: "done" };
  }

  private first(query: SourceQuery): Cursor | undefined {
    return query.queries.length > 0 ? { index: 0, pages: 0 } : undefined;
  }

  private advance(query: SourceQuery, at: Cursor): Cursor | undefined {
    const index = at.index + 1;
    return index < query.queries.length ? { index, pages: 0 } : undefined;
  }
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function dateOf(value: unknown): Date | undefined {
  const stamp = text(value);
  if (!stamp) return undefined;

  const date = new Date(stamp);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function countOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * One record of `videos` to one `CandidatePost`.
 *
 * **The date is `publishDate` and the fallback is marked approximate.**
 * `publishedTime` is an ISO string the provider computes from
 * `publishedTimeText` — "3 weeks ago" — so every video in an answer carries the
 * same time of day. It arrives on every record and it is the wrong one. When
 * the real date is missing, which means `includeExtras` did not reach this
 * call, the computed one is used and flagged, so a caller applies no `since`
 * cut to it rather than silently trusting arithmetic.
 */
export function toCandidatePost(record: unknown): CandidatePost | undefined {
  const video = objectOf(record);
  if (!video) return undefined;

  const externalId = text(video.id);
  const url = text(video.url);
  const title = text(video.title);

  const exact = dateOf(video.publishDate);
  const computed = dateOf(video.publishedTime);
  const postedAt = exact ?? computed;

  if (!externalId || !url || !title || !postedAt) return undefined;

  const description = text(video.description);
  const author = text(objectOf(video.channel)?.handle) ?? text(objectOf(video.channel)?.title);
  const replyCount = countOf(video.commentCountInt);

  return {
    externalId,
    url,
    ...(author ? { author } : {}),
    title,
    /**
     * The title and the description together, because that is the whole point
     * of this connector. A title alone is 68 characters and this product
     * classifies text.
     */
    text: description ? `${title}\n\n${description}` : title,
    postedAt,
    ...(exact ? {} : { postedAtIsApproximate: true }),
    ...(replyCount === undefined ? {} : { replyCount }),
  };
}

interface ReplyContext {
  readonly parentPostExternalId: string;
  readonly position: number;
  readonly postUrl: string;
}

/**
 * One record of `comments` to one `CandidateReply`.
 *
 * The payload names no parent post and no parent comment, so the parent is
 * the video the caller asked about, and a reply under a reply — `replyLevel`
 * above zero — is never on this page. BUG-007's check cannot be made here:
 * nothing on a comment says which video it belongs to.
 *
 * The date is always marked approximate. `publishedTime` is computed from
 * `publishedTimeText` at the moment of the call — every comment on a page
 * carries the same time of day — and unlike a video there is no
 * `includeExtras` to ask for the real one. The relative text is kept beside
 * it, because it says how approximate: see `precisionOf`.
 */
export function toCandidateReply(
  record: unknown,
  context: ReplyContext,
): (CandidateReply & { readonly postedAtPrecisionMs?: number }) | undefined {
  const comment = objectOf(record);
  if (!comment) return undefined;

  const externalId = text(comment.id);
  const body = text(comment.content);
  const postedAt = dateOf(comment.publishedTime);

  if (!externalId || !body || !postedAt) return undefined;

  const author = text(objectOf(comment.author)?.name);
  const replyCount = countOf(objectOf(comment.engagement)?.replies);
  const precision = precisionOf(text(comment.publishedTimeText));

  return {
    externalId,
    url: commentLink(context.postUrl, externalId),
    ...(author ? { author } : {}),
    text: body,
    postedAt,
    postedAtIsApproximate: true,
    ...(precision === undefined ? {} : { postedAtPrecisionMs: precision }),
    parentPostExternalId: context.parentPostExternalId,
    threadPosition: context.position,
    ...(replyCount === undefined ? {} : { replyCount }),
  };
}

/**
 * YouTube's own link to one comment: the video's URL with `lc=<comment id>`,
 * which opens the video with that comment pinned above the thread. Opened in
 * a browser on 2026-09-15, US-135 — AGENTS.md's rule that a URL we build is
 * evidence about our own string building until somebody presses it.
 */
export function commentLink(postUrl: string, commentId: string): string {
  const url = new URL(postUrl);
  url.searchParams.set("lc", commentId);
  return url.toString();
}

/**
 * How far off a computed date can be, from the text it was computed from.
 *
 * "3 weeks ago" was written any time in the week before the provider's
 * subtraction lands, and "4 years ago" any time in the year. Unreadable text
 * answers nothing, and a caller keeps the comment rather than cut on a date
 * with no known error.
 */
export function precisionOf(relative: string | undefined): number | undefined {
  const match = relative?.match(
    /^\s*(?:\d+|an?)\s+(second|minute|hour|day|week|month|year)s?\s+ago/,
  );
  if (!match) return undefined;

  const unit = match[1] as "second" | "minute" | "hour" | "day" | "week" | "month" | "year";
  return {
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 7 * 86_400_000,
    month: 31 * 86_400_000,
    year: 366 * 86_400_000,
  }[unit];
}

/**
 * Whether a comment with an approximate date might have been written after
 * `since`. A comment is dropped only when even the latest moment its text
 * allows is not after the cut; a comment whose text could not be read is
 * kept, by the rule on `postedAtIsApproximate`.
 */
function couldBeAfter(
  reply: CandidateReply & { readonly postedAtPrecisionMs?: number },
  since: Date,
): boolean {
  if (reply.postedAtPrecisionMs === undefined) return true;
  return reply.postedAt.getTime() + reply.postedAtPrecisionMs > since.getTime();
}

/**
 * Whether this page leaves replies behind it, under the comments it returned.
 * A parent that claims replies, or carries a token to fetch them, has a
 * subtree this connector did not buy.
 */
function hasUnreadReplies(records: readonly unknown[]): boolean {
  return records.some((record) => {
    const comment = objectOf(record);
    if (!comment) return false;
    if (text(comment.repliesContinuationToken)) return true;
    return (countOf(objectOf(comment.engagement)?.replies) ?? 0) > 0;
  });
}
