/**
 * TikTok through ScrapeCreators. US-126.
 *
 * The second provider for a platform we already fetch, so nothing downstream
 * learns which one answered. Every shape below was captured from a live account
 * by `tiktok-fixtures/capture.mjs` on 2026-09-11 and recorded in US-119. Five
 * of its findings are the reason this file is not `reddit.ts` with a different
 * URL:
 *
 * 1. **Relevance inside a window, never date order.** `sort_by=date-posted`
 *    sorts, and it ruins the result: `flaky tests` returned dog skin
 *    conditions, dandruff and a flaky croissant, because TikTok matches
 *    `flaky` as an ordinary word. 4 of 30 captions mentioned software on one
 *    run and 10 on another, and the ones that did were false. Ranked by
 *    relevance the same query was 18 of 30, and six years wide. Relevance plus
 *    `date_posted` was 14 and then 20 of 30, every video inside the window.
 *    So this connector asks for relevance and narrows with a window, and the
 *    ordering parameter is one it must never send.
 * 2. **The page is therefore not in date order**, so `reddit.ts`'s third
 *    stopping rule — this page is all older than `since`, so stop — is wrong
 *    here and is absent, the same way it is absent from
 *    `socialcrawl/linkedin.ts`. The exact cut is made below.
 * 3. **A search matching nothing answers `success: true` with thirty unrelated
 *    videos, and bills for it.** There is no empty answer to read. A monitor
 *    with a bad query pays every poll and nothing in the answer says the query
 *    was the problem, so the cost test and the budget guard are what protect a
 *    person here — not this connector.
 * 4. **`share_url` carries TikTok's share tracking** —
 *    `?_r=1&u_code=…&source=h5_m` — and the provider's own transcript endpoint
 *    refuses the URL until it is stripped. SocialCrawl returns the same video
 *    as a clean address, so storing it raw would hold one video under two URLs
 *    and make deduplication harder for nothing.
 * 5. **Page two may repeat page one.** Seven of thirty on one run, none on
 *    another, and the provider's own documentation says TikTok may return
 *    duplicates. A repeat is billed in full and is not an error; `posts`
 *    deduplicates on the id, which is TikTok's own.
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
/**
 * TikTok's own comment link, and it is imported rather than copied.
 *
 * The format belongs to the platform and not to whoever fetched the comment:
 * US-047 read it off a TikTok notification and then opened one. Two providers
 * building the same link two ways is how one of them gets fixed and the other
 * does not.
 */
import { commentLink } from "../socialcrawl/tiktok.js";
import type { Page } from "./client.js";
import {
  endpoints,
  ScrapeCreatorsClient,
  ScrapeCreatorsError,
  tikTokCommentsShape,
  tikTokSearchShape,
} from "./client.js";
import { scrapeCreatorsProvider } from "./provider.js";

/** A search page is 30 videos, so two is more than a poll will read. */
const maxPagesPerInput = 2;

export const scrapeCreatorsTikTok: ConnectorDefinition = {
  platform: tikTokPlatform,
  provider: scrapeCreatorsProvider,
  /**
   * A request, and the same $1.88 per thousand the Reddit connector is priced
   * at. One provider, one credit pack, and this platform spends one credit a
   * call — which is not a thing that could be assumed: SocialCrawl spends one
   * credit on an X call and five on a LinkedIn one through a single key.
   */
  billableUnit: "request",
  pricePerUnitMicros: 1880,
  /** Thirty videos for one credit, measured twice in US-119. */
  postsPerUnit: 30,
  discovery: ["keyword"],
  /** We build `?cid=`, and US-047 opened one: it lands on the comment. */
  linksToComments: true,
  maxUnitsPerQueryPoll: maxPagesPerInput,
  canFetchReplies: true,
  /** A comment page is one credit, the same as a search. Measured in US-119. */
  replyPricePerUnitMicros: 1880,
  create: (runtime) => new ScrapeCreatorsTikTokSource(runtime),
};

/**
 * The windows this endpoint accepts, narrowest first.
 *
 * Read from the provider's OpenAPI document, which is free, and then used in a
 * live call. An invalid value would not have listed them: this provider ignores
 * a parameter it does not recognise and bills the call in full, so the
 * technique that makes its Reddit endpoint name its own vocabulary does not
 * work here.
 *
 * `all-time` has no span because it is the fallback when nothing narrower
 * covers `since`, or when a monitor has no `since` at all.
 */
const windows = [
  { value: "yesterday", days: 1 },
  { value: "this-week", days: 7 },
  { value: "this-month", days: 31 },
  { value: "last-3-months", days: 92 },
  { value: "last-6-months", days: 184 },
] as const;

const widestWindow = "all-time";

/**
 * The narrowest window that still covers everything the caller asked for.
 *
 * Narrower is cheaper in relevance, not in credits: one call is one credit
 * whatever it returns, and a window that cuts too early loses posts silently.
 * So the rule is to cover `since` and no more, and to be generous at the edge —
 * the spans above are a day or two longer than their names suggest, because
 * "this-month" is the provider's word and not a measured 30 days.
 */
export function windowFor(since: Date | undefined, now: Date): string {
  if (!since) return widestWindow;

  const days = (now.getTime() - since.getTime()) / 86_400_000;
  const fit = windows.find((window) => days <= window.days);

  return fit ? fit.value : widestWindow;
}

/**
 * A TikTok post URL, with the share tracking taken off.
 *
 * `share_url` arrives as
 * `https://www.tiktok.com/@handle/video/<id>?_r=1&u_code=…&source=h5_m`. The
 * id and the handle are the address; everything after the question mark is a
 * share token that names the session that produced it.
 */
export function cleanPostUrl(url: string): string {
  const cut = url.indexOf("?");
  return cut === -1 ? url : url.slice(0, cut);
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
    throw new Error(`${tikTokPlatform.id}: cursor "${cursor}" was not issued by this source.`);
  }

  return { index, pages, ...(after ? { after } : {}) };
}

export class ScrapeCreatorsTikTokSource implements SocialSource {
  readonly platform = scrapeCreatorsTikTok.platform;
  readonly provider = scrapeCreatorsTikTok.provider;
  readonly billableUnit = scrapeCreatorsTikTok.billableUnit;
  readonly pricePerUnitMicros = scrapeCreatorsTikTok.pricePerUnitMicros;
  readonly maxUnitsPerQueryPoll = scrapeCreatorsTikTok.maxUnitsPerQueryPoll;
  readonly canFetchReplies = scrapeCreatorsTikTok.canFetchReplies;
  readonly replyPricePerUnitMicros = scrapeCreatorsTikTok.replyPricePerUnitMicros;

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
    // when its queries were edited between two polls. Finishing is safe: the
    // next poll starts again from the first query.
    if (query === undefined) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    let page: Page;

    try {
      page = await this.client(request.credentials).fetchPage(
        endpoints.tikTokSearch,
        {
          query,
          /**
           * Relevance, always. The measured alternative is in the header, and
           * this is the one line of this connector that decides whether it
           * finds anything worth reading.
           */
          sort_by: "relevance",
          date_posted: windowFor(request.query.since, this.runtime.now()),
          ...(start.after ? { cursor: start.after } : {}),
        },
        tikTokSearchShape,
        request.signal,
      );
    } catch (error) {
      // A rate limit is the one failure the caller can act on by waiting. It is
      // handed up rather than slept through. This branch has never been reached
      // against the real provider: no capture run has been rate-limited.
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

    const wanted = collected.filter(
      (post) => !request.query.since || post.postedAt > request.query.since,
    );

    // Truncating costs nothing: the credit was spent on the request and not on
    // the videos. On a provider that bills per record it would waste all of it.
    const posts = request.limit === undefined ? wanted : wanted.slice(0, request.limit);

    return {
      posts,
      unitsConsumed: page.creditsCharged,
      next: this.nextAfter(request.query, start, page),
    };
  }

  /**
   * One page of the comments under one video.
   *
   * The date cut is applied here because this endpoint offers no date
   * parameter, and every row is tested rather than the walk being stopped at
   * the first old one: nothing promises an ordering, and an old comment says
   * nothing about the next.
   */
  async fetchReplies(request: ReplyRequest): Promise<ReplyResult> {
    const page = await this.client(request.credentials).fetchPage(
      endpoints.tikTokComments,
      {
        // Stripped, because the provider refuses a URL with share tracking on
        // it — measured on the transcript endpoint in US-119, in the
        // provider's own words.
        url: cleanPostUrl(request.postUrl),
        ...(request.cursor ? { cursor: request.cursor } : {}),
      },
      tikTokCommentsShape,
      request.signal,
    );

    const replies = page.records
      .map((record, index) =>
        toCandidateReply(record, {
          parentPostExternalId: request.postExternalId,
          position: (request.positionOffset ?? 0) + index,
          postUrl: cleanPostUrl(request.postUrl),
        }),
      )
      .filter((reply): reply is CandidateReply => reply !== undefined)
      .filter((reply) => !request.since || reply.postedAt > request.since);

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
   * Two things end a query, and the third one `reddit.ts` has is deliberately
   * missing: this page is not in date order, so a page of old videos says
   * nothing about the next page and cannot end the walk.
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

/**
 * Whether this page leaves replies behind it, under the comments it returned.
 *
 * A TikTok comment carries `reply_comment_total` and a `reply_comment` array
 * holding at most a couple of them. The captured page claimed 4, 49, 22, 47,
 * 10, 4, 12 and 1 replies across its eleven comments, and this connector reads
 * none of them: they are a second walk with a second bill.
 *
 * So a thread is `partial` whenever any comment says it has replies, quite
 * apart from whether the top-level list has another page. `ReplyResult.partial`
 * exists for exactly this: ScrapeCreators has already been measured reporting
 * `has_more: false` on Reddit while nested subtrees still had more.
 */
function hasUnreadReplies(records: readonly unknown[]): boolean {
  return records.some((record) => {
    const comment = objectOf(record);
    if (!comment) return false;

    if (comment.thread_has_more === true) return true;

    const total = countOf(comment.reply_comment_total) ?? 0;
    const read = Array.isArray(comment.reply_comment) ? comment.reply_comment.length : 0;

    return total > read;
  });
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** TikTok counts in whole seconds. Anything else is a shape we do not know. */
function dateOfSeconds(value: unknown): Date | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;

  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function countOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * One record of `search_item_list` to one `CandidatePost`.
 *
 * The record wraps the video in `aweme_info`, which is raw TikTok — this
 * provider normalises nothing. Every field is checked rather than trusted: a
 * video with no id, no URL, no timestamp or no caption is not one we can store,
 * deduplicate or classify, and such a record is dropped rather than repaired.
 */
export function toCandidatePost(record: unknown): CandidatePost | undefined {
  const item = objectOf(record);
  const video = objectOf(item?.aweme_info) ?? item;
  if (!video) return undefined;

  const externalId = text(video.aweme_id);
  const shareUrl = text(video.share_url) ?? text(objectOf(video.share_info)?.share_url);
  const postedAt = dateOfSeconds(video.create_time);
  const caption = text(video.desc);

  // A video with no caption carries no words at all. It is skipped rather than
  // stored empty: there is nothing for a model to read, and an empty excerpt
  // would buy a classification to score silence.
  if (!externalId || !shareUrl || !postedAt || !caption) return undefined;

  const author = text(objectOf(video.author)?.unique_id);
  const replyCount = countOf(objectOf(video.statistics)?.comment_count);

  return {
    externalId,
    url: cleanPostUrl(shareUrl),
    ...(author ? { author } : {}),
    text: caption,
    postedAt,
    ...(replyCount === undefined ? {} : { replyCount }),
  };
}

interface ReplyContext {
  readonly parentPostExternalId: string;
  readonly position: number;
  readonly postUrl: string;
}

/**
 * One captured comment to one `CandidateReply`.
 *
 * **The parent check is live on this connector**, unlike on Instagram. US-119
 * found `cid`, `create_time` and `aweme_id` on all eleven captured comments, so
 * BUG-007's rule — a comment that says it belongs to another post is dropped,
 * not stored under the one we asked about — has something to compare.
 *
 * The link is built rather than read. `share_info.url` sometimes holds a real
 * comment link and sometimes an empty string, decided by `share_info.acl.code`:
 * it was present on one capture and absent from all eleven comments of the
 * next. A field that is there half the time is not an identifier a person can
 * be shown.
 */
export function toCandidateReply(
  record: unknown,
  context: ReplyContext,
): CandidateReply | undefined {
  const comment = objectOf(record);
  if (!comment) return undefined;

  const externalId = text(comment.cid);
  const body = text(comment.text);
  const postedAt = dateOfSeconds(comment.create_time);

  if (!externalId || !body || !postedAt) return undefined;

  // BUG-007: a provider asked for one thread can answer with a comment from
  // another. Where the comment names its post, disagreeing with the post we
  // asked about is enough to drop it.
  const saysParent = text(comment.aweme_id);
  if (saysParent && saysParent !== context.parentPostExternalId) return undefined;

  const author = text(objectOf(comment.user)?.unique_id);
  const replyTo = text(comment.reply_id);
  const replyCount = countOf(comment.reply_comment_total);

  return {
    externalId,
    url: commentLink(context.postUrl, externalId),
    ...(author ? { author } : {}),
    text: body,
    postedAt,
    parentPostExternalId: context.parentPostExternalId,
    // TikTok writes "0" for a comment that sits directly under the video.
    ...(replyTo && replyTo !== "0" ? { parentReplyExternalId: replyTo } : {}),
    threadPosition: context.position,
    ...(replyCount === undefined ? {} : { replyCount }),
  };
}
