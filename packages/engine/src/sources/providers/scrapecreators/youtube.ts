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
 * Four measured facts shape everything below.
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
   * Comments, at one credit for twenty — and the weakest reply answer in this
   * product. US-159 turned it on and the reasons it was off are all still
   * true.
   *
   * It exists so that an instance holding only this provider's key is not
   * silently given no YouTube replies at all. `socialcrawl/youtube.ts` remains
   * the better connector for a monitor that wants them, and the monitor form
   * tells a person which one their key will use.
   *
   * Three limits a caller must know, all measured on 2026-09-17:
   *
   * 1. **No comment carries a permalink**, on 60 of 60. The link is built the
   *    way `socialcrawl/youtube.ts` builds it.
   * 2. **No comment carries a parent id**, on 60 of 60, and every one arrived
   *    at `replyLevel` 0. So nesting cannot be stored, and BUG-007's
   *    wrong-parent check is inert here: there is no `post_id` to disagree
   *    with. A nested reply is reachable only through its own
   *    `repliesContinuationToken`, which is a second walk with a second bill
   *    and is not read.
   * 3. **Every date is computed from relative text.** Twenty comments on one
   *    page shared one timestamp to the millisecond, because the provider
   *    subtracts "4 years ago" from the moment of the call. Every reply is
   *    marked `postedAtIsApproximate`.
   */
  canFetchReplies: true,
  /** The same credit as a search: one, for a page of twenty comments. */
  replyPricePerUnitMicros: 1880,
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
  readonly replyPricePerUnitMicros = scrapeCreatorsYouTube.replyPricePerUnitMicros;

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
   * One page of the comments under one video. US-159.
   *
   * Twenty comments for one credit, and `continuationToken` pages them with no
   * overlap — measured, not read off the search endpoint's parameter names.
   *
   * **Nothing here stops early, and the reason is a failed measurement.**
   * `order` is documented as `top` or `newest`; both were asked for the same
   * video on 2026-09-17 and both answered with the same twenty comments in the
   * same order, opening on the same one. Page two then arrived out of date
   * order entirely — "11 months ago" above "4 years ago". So this connector has
   * no ordering to stand on, and `socialcrawl/youtube.ts`'s early stop, which
   * rests on a guarantee that provider does give, has no equivalent here.
   */
  async fetchReplies(request: ReplyRequest): Promise<ReplyResult> {
    const page = await this.client(request.credentials).fetchPage(
      endpoints.youTubeComments,
      {
        url: request.postUrl,
        /**
         * Asked for, and not believed. The measurement above says the value is
         * ignored. It is still sent, because the day the provider starts
         * reading it, newest is what a monitor wants.
         */
        order: "newest",
        ...(request.cursor ? { continuationToken: request.cursor } : {}),
      },
      youTubeCommentsShape,
      request.signal,
    );

    const parsed = page.records
      .map((record, index) =>
        toCandidateReply(record, {
          parentPostExternalId: request.postExternalId,
          position: (request.positionOffset ?? 0) + index,
        }),
      )
      .filter((reply): reply is CandidateReply => reply !== undefined);

    /**
     * The window, applied to a date the provider itself computes — and this is
     * the one place this connector departs from `search` above.
     *
     * `search` keeps a post whose date is approximate, on US-034's rule that
     * dropping it loses a lead nobody can tell was lost. Copying that here
     * would keep **every** comment, because every comment's date is computed,
     * and that is precisely the fault US-034 found live: a comment written in
     * June 2021 reaching the inbox as a lead, 1,915 days old.
     *
     * So the cut is made, and the relative label is good enough to make it.
     * YouTube writes "2 hours ago" for a comment that is hours old and "4
     * years ago" for one that is years old, so the value is precise exactly
     * where a monitor's window sits and coarse only far outside it. What it
     * cannot do is decide a boundary case: a comment labelled "1 month ago"
     * against a window of three weeks is kept or dropped by up to a fortnight
     * of arithmetic. That is the price of the platform's only timestamp.
     */
    const replies = request.since
      ? parsed.filter((reply) => reply.postedAt > (request.since as Date))
      : parsed;

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

/**
 * Whether this page leaves replies behind it, underneath the comments it
 * returned.
 *
 * A YouTube comment carries `repliesContinuationToken` when it has a thread of
 * its own, and this connector reads none of them: each is a second walk with a
 * second bill. Eleven of the sixty captured comments carried one, claiming 18,
 * 17, 11 and 2 replies among them.
 *
 * So a thread is `partial` whenever any comment says it has more underneath,
 * quite apart from whether the top-level list has another page. That is what
 * `ReplyResult.partial` is for, and the same rule `scrapecreators/tiktok.ts`
 * applies to `reply_comment_total`.
 */
function hasUnreadReplies(records: readonly unknown[]): boolean {
  return records.some((record) => {
    const comment = objectOf(record);
    if (!comment) return false;

    if (text(comment.repliesContinuationToken)) return true;

    return (countOf(objectOf(comment.engagement)?.replies) ?? 0) > 0;
  });
}

interface ReplyContext {
  readonly parentPostExternalId: string;
  readonly position: number;
}

/**
 * One captured comment to one `CandidateReply`.
 *
 * **The link is built, because the provider sends none** — 60 of 60 captured
 * comments carry no `url`. It is YouTube's own linked-comment form,
 * `watch?v=<video>&lc=<comment>`, which is what the platform's Share button
 * produces and what `socialcrawl/youtube.ts` already builds for the same
 * reason. The video id is the one this poll asked about, so the link is made
 * of two ids we hold rather than of anything guessed — and one built from
 * this capture was opened on 2026-09-17: YouTube showed it as the highlighted
 * comment at the top of the thread, with the captured text.
 *
 * **There is no parent to check and none to store.** No captured comment
 * carries a post id, so BUG-007's wrong-parent rule has nothing to compare and
 * is inert here, exactly as it is on Instagram. None carries a parent comment
 * id either, and all sixty arrived at `replyLevel` 0 — a nested reply is
 * behind its own continuation token and is not read — so
 * `parentReplyExternalId` is never set rather than being inferred from the
 * level.
 *
 * **Every date is marked approximate.** Twenty comments on one page shared one
 * timestamp to the millisecond, because the provider subtracts
 * `publishedTimeText` from the moment of the call. The value is still the best
 * this endpoint has, and `postedAtIsApproximate` is how nothing downstream
 * mistakes it for a reading.
 */
export function toCandidateReply(
  record: unknown,
  { parentPostExternalId, position }: ReplyContext,
): CandidateReply | undefined {
  const comment = objectOf(record);
  if (!comment) return undefined;

  const externalId = text(comment.id);
  const body = text(comment.content);
  const postedAt = dateOf(comment.publishedTime);

  if (!externalId || !body || !postedAt) return undefined;

  const author = text(objectOf(comment.author)?.name);
  const replyCount = countOf(objectOf(comment.engagement)?.replies);

  return {
    externalId,
    url: `https://www.youtube.com/watch?v=${parentPostExternalId}&lc=${externalId}`,
    ...(author ? { author } : {}),
    text: body,
    postedAt,
    postedAtIsApproximate: true,
    parentPostExternalId,
    threadPosition: position,
    ...(replyCount === undefined ? {} : { replyCount }),
  };
}
