/**
 * Public Facebook groups through ScrapeCreators. US-516, US-557.
 *
 * A query is one of two things, told apart by its form. The full address of a
 * public group is read, newest first (US-516). Anything else is a phrase,
 * searched on Google within public groups (US-557). A monitor may hold both,
 * and the connector walks its queries in order.
 *
 * **A phrase.** `<phrase> site:facebook.com/groups` through Google, limited
 * to the smallest window that covers `since`: the past day for a monitor
 * that polls every hour. Google shows a post hours after it is written, so a
 * past-hour window would miss most posts; the past day is asked every time
 * and the pipeline drops what it holds. Google ranks by relevance, not by
 * date, so no page says the read is done: the phrase reads its page cap, or
 * until Google has no next page. A result is a group post's address, its
 * first line and a snippet whose first words are an age ("8 hours ago"). That
 * age is Google's, so the post carries `postedAtIsApproximate` and no `since`
 * cut. The post is `partial`: `completePosts` reads it whole, 1 credit, only
 * once the filter keeps it, because most results for a product phrase are
 * sale listings (US-557's Log).
 *
 * **A group.** One request reads one page of three or four posts, and a group
 * may be paged back to `since` within a cap.
 *
 * The provider may put an older top post above newer ones, so a page with one
 * old post does not end the read. The read continues only when the page held
 * at least one post newer than `since`, the answer names a cursor, and the
 * group has not reached its page cap. Otherwise it moves to the next group.
 *
 * A post id already returned for the same group in the same read is dropped.
 * A post with no text is a photo or a video and is skipped.
 *
 * A missing or private group answers HTTP 500 with `isn't available`, billed
 * nothing. That one case is logged and skipped; every other provider error is
 * thrown.
 */
import { pagesPerInputFor } from "../../pages.js";
import { facebookPlatform } from "../../platforms.js";
import type {
  CandidatePost,
  CompleteRequest,
  CompleteResult,
  ConnectorDefinition,
  CredentialCheck,
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
  facebookGroupShape,
  googleSearchShape,
  ScrapeCreatorsClient,
  ScrapeCreatorsError,
} from "./client.js";
import { scrapeCreatorsProvider } from "./provider.js";

/** The default page cap for one group in one poll. */
export const maxPagesPerGroup = 5;
/** The default page cap for one phrase in one poll: 20 results. */
export const defaultPagesPerPhrase = 2;
/** The last page Google search answers; page 12 is refused. */
export const maxPagesPerPhrase = 11;

/** The price of one request, as every endpoint on this key is priced. */
const pricePerUnitMicros = 1880;
/** Three posts is the smallest page measured for this endpoint. */
const postsPerUnit = 3;

export interface FacebookOptions {
  /** Pages one group may read in one poll: a whole number from 1 to 5. */
  readonly pagesPerGroup?: number;
  /** Search pages one phrase may read in one poll: a whole number from 1 to 11. */
  readonly pagesPerPhrase?: number;
}

function checkCap(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${name} must be a whole number from 1 to ${max}, not ${value}`);
  }
}

/**
 * The connector, reading at most `pagesPerGroup` pages of one group and
 * `pagesPerPhrase` search pages of one phrase a poll. An application sets
 * lower caps to spend less.
 */
export function createScrapeCreatorsFacebook(options: FacebookOptions = {}): ConnectorDefinition {
  const pagesPerGroup = options.pagesPerGroup ?? maxPagesPerGroup;
  const pagesPerPhrase = options.pagesPerPhrase ?? defaultPagesPerPhrase;
  checkCap("pagesPerGroup", pagesPerGroup, maxPagesPerGroup);
  checkCap("pagesPerPhrase", pagesPerPhrase, maxPagesPerPhrase);

  return {
    platform: facebookPlatform,
    provider: scrapeCreatorsProvider,
    billableUnit: "request",
    pricePerUnitMicros,
    postsPerUnit,
    discovery: ["keyword", "channel"],
    linksToComments: false,
    canFetchReplies: false,
    maxUnitsPerQueryPoll: Math.max(pagesPerGroup, pagesPerPhrase),
    create: (runtime) => new ScrapeCreatorsFacebookSource(runtime, pagesPerGroup, pagesPerPhrase),
  };
}

export const scrapeCreatorsFacebook: ConnectorDefinition = createScrapeCreatorsFacebook();

/** Where the caller is. A cursor names a group and the pages read from it. */
interface Cursor {
  readonly index: number;
  readonly pages: number;
  readonly after?: string;
  /** Post ids already returned for this input in this read. */
  readonly seen?: readonly string[];
  /** Set when `after` is a search page, not a group's cursor (US-557). */
  readonly phrase?: true;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(cursor: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;

    if (
      Number.isInteger(parsed.index) &&
      parsed.index >= 0 &&
      Number.isInteger(parsed.pages) &&
      parsed.pages >= 0
    ) {
      return parsed;
    }
  } catch {
    // Not one of ours: refused below.
  }

  throw new Error(`facebook: cursor "${cursor}" was not issued by this source.`);
}

export class ScrapeCreatorsFacebookSource implements SocialSource {
  readonly platform = facebookPlatform;
  readonly provider = scrapeCreatorsProvider;
  readonly billableUnit = "request";
  readonly pricePerUnitMicros = pricePerUnitMicros;
  readonly postsPerUnit = postsPerUnit;
  readonly discovery = ["keyword", "channel"] as const;
  readonly linksToComments = false;
  readonly canFetchReplies = false;
  readonly maxUnitsPerQueryPoll: number;

  constructor(
    private readonly runtime: SourceRuntime,
    private readonly pagesPerGroup = maxPagesPerGroup,
    private readonly pagesPerPhrase = defaultPagesPerPhrase,
  ) {
    this.maxUnitsPerQueryPoll = Math.max(pagesPerGroup, pagesPerPhrase);
  }

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
    const saved =
      request.cursor === undefined ? this.first(request.query) : decodeCursor(request.cursor);

    if (!saved) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    const query = request.query.queries[saved.index];

    // The monitor's queries changed between two polls. Finishing is safe: the
    // next poll starts again from the first query.
    if (query === undefined) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    // A list edited between two polls can put a phrase where a group was, or
    // the reverse. A group's cursor sent as a search page, or a page number as
    // a group's cursor, is billed for nothing, so that input starts over.
    const phrase = !isGroupAddress(query);
    const start: Cursor =
      saved.after !== undefined && (saved.phrase === true) !== phrase
        ? { index: saved.index, pages: 0 }
        : saved;

    if (phrase) return this.searchPhrase(request, start, query);

    const foundBy = { kind: "channel" as const, value: query };
    const cap = pagesPerInputFor(request, this.pagesPerGroup);
    let page: Page;

    try {
      page = await this.client(request.credentials).fetchPage(
        endpoints.facebookGroupPosts,
        {
          url: query,
          sort_by: "CHRONOLOGICAL",
          ...(start.after ? { cursor: start.after } : {}),
        },
        facebookGroupShape,
        request.signal,
      );
    } catch (error) {
      // A rate limit is the one failure the caller can act on by waiting.
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

      // The provider names both a missing group and a private one with this
      // sentence, and bills neither. Any other provider error is not skipped.
      if (
        error instanceof ScrapeCreatorsError &&
        error.kind === "provider" &&
        error.message.includes("isn't available")
      ) {
        this.runtime.logger.warn(
          { group: query },
          `Facebook group skipped: ${query} is missing or private.`,
        );
        return {
          posts: [],
          foundBy,
          unitsConsumed: 0,
          next: this.afterInput(request.query, start),
        };
      }

      throw error;
    }

    const collected = page.records
      .map((record) => toCandidatePost(record, query))
      .filter((post): post is CandidatePost => post !== undefined);

    const seen = new Set(start.seen ?? []);
    const newer = collected.filter(
      (post) => !request.query.since || post.postedAt > request.query.since,
    );
    const fresh: CandidatePost[] = [];

    for (const post of collected) {
      if (!seen.has(post.externalId) && newer.includes(post)) fresh.push(post);
      seen.add(post.externalId);
    }

    const posts = request.limit === undefined ? fresh : fresh.slice(0, request.limit);

    return {
      posts,
      foundBy,
      unitsConsumed: page.creditsCharged,
      next: this.nextAfter(request.query, start, page, cap, newer.length > 0, [...seen]),
    };
  }

  /** One search page of one phrase: see the header. */
  private async searchPhrase(
    request: SearchRequest,
    start: Cursor,
    phrase: string,
  ): Promise<SearchResult> {
    const foundBy = { kind: "query" as const, value: phrase };
    const cap = Math.min(pagesPerInputFor(request, this.pagesPerPhrase), maxPagesPerPhrase);
    const now = this.runtime.now();
    let page: Page;

    try {
      page = await this.client(request.credentials).fetchPage(
        endpoints.googleSearch,
        {
          query: `${phrase} site:facebook.com/groups`,
          date_posted: windowFor(request.query.since, now),
          ...(start.after ? { page: start.after } : {}),
        },
        googleSearchShape,
        request.signal,
      );
    } catch (error) {
      if (error instanceof ScrapeCreatorsError && error.kind === "rateLimit") {
        return {
          posts: [],
          unitsConsumed: 0,
          next: {
            status: "wait",
            retryAfter: error.retryAfter ?? new Date(now.getTime() + 60_000),
            cursor: encodeCursor(start),
          },
        };
      }

      // A search that finds nothing answers 404, unbilled.
      if (error instanceof ScrapeCreatorsError && error.httpStatus === 404) {
        return {
          posts: [],
          foundBy,
          unitsConsumed: 0,
          next: this.afterInput(request.query, start),
        };
      }

      throw error;
    }

    const seen = new Set(start.seen ?? []);
    const fresh: CandidatePost[] = [];

    for (const record of page.records) {
      const post = toSearchPost(record, now);
      if (!post || seen.has(post.externalId)) continue;
      seen.add(post.externalId);
      fresh.push(post);
    }

    const posts = request.limit === undefined ? fresh : fresh.slice(0, request.limit);
    const pages = start.pages + 1;
    const next: SearchResult["next"] =
      page.records.length > 0 && page.after && pages < cap
        ? {
            status: "ready",
            cursor: encodeCursor({
              index: start.index,
              pages,
              after: page.after,
              seen: [...seen],
              phrase: true,
            }),
          }
        : this.afterInput(request.query, start);

    return { posts, foundBy, unitsConsumed: page.creditsCharged, next };
  }

  /**
   * The posts a phrase found, whole, one request each. A post that is gone,
   * behind a login, or has no words (a photo, a video) keeps its partial text.
   * A refused key throws: every post after it would be refused too.
   */
  async *completePosts(request: CompleteRequest): AsyncIterable<CompleteResult> {
    const client = this.client(request.credentials);

    for (const { url } of request.posts) {
      try {
        const answer = await client.fetchRecord(endpoints.facebookPost, { url }, request.signal);
        if (!answer.found) {
          yield {
            status: "unread",
            reason: "The post is gone or needs a login.",
            unitsConsumed: answer.creditsCharged,
          };
          continue;
        }

        const post = toReadPost(answer.record, url);
        yield post
          ? { status: "complete", post, unitsConsumed: answer.creditsCharged }
          : {
              status: "unread",
              reason: "The post has no words: a photo or a video.",
              unitsConsumed: answer.creditsCharged,
            };
      } catch (error) {
        if (error instanceof ScrapeCreatorsError && error.kind === "credentials") throw error;
        yield {
          status: "unread",
          reason: error instanceof Error ? error.message : String(error),
          unitsConsumed: 0,
        };
      }
    }
  }

  private nextAfter(
    query: SourceQuery,
    at: Cursor,
    page: Page,
    cap: number,
    hasNewer: boolean,
    seen: readonly string[],
  ): SearchResult["next"] {
    const pages = at.pages + 1;

    if (hasNewer && page.after && pages < cap) {
      return {
        status: "ready",
        cursor: encodeCursor({ index: at.index, pages, after: page.after, seen }),
      };
    }

    return this.afterInput(query, at);
  }

  private first(query: SourceQuery): Cursor | undefined {
    return query.queries.length > 0 ? { index: 0, pages: 0 } : undefined;
  }

  private afterInput(query: SourceQuery, at: Cursor): SearchResult["next"] {
    const index = at.index + 1;
    return index < query.queries.length
      ? { status: "ready", cursor: encodeCursor({ index, pages: 0 }) }
      : { status: "done" };
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

/** Facebook counts in whole seconds. */
function dateOfSeconds(value: unknown): Date | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;

  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function countOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** The group part of an address: the path segment after `/groups/`. */
export function groupOf(address: string): string | undefined {
  try {
    const match = new URL(address).pathname.match(/\/groups\/([^/]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a query is a group's address (read the group) or a phrase (search for it). */
export function isGroupAddress(query: string): boolean {
  return /^https?:\/\//i.test(query.trim()) && groupOf(query.trim()) !== undefined;
}

const hourMs = 3_600_000;

/**
 * The smallest Google window that covers `since`. No `since` is a first poll,
 * which reads the past week.
 */
export function windowFor(
  since: Date | undefined,
  now: Date,
): "last-day" | "last-week" | "last-month" {
  if (since === undefined) return "last-week";
  const ago = now.getTime() - since.getTime();
  if (ago <= 24 * hourMs) return "last-day";
  if (ago <= 7 * 24 * hourMs) return "last-week";
  return "last-month";
}

const unitMs: Record<string, number> = {
  minute: 60_000,
  hour: hourMs,
  day: 24 * hourMs,
  week: 7 * 24 * hourMs,
};
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The age a snippet starts with, and the text after it. Google writes a
 * relative age ("8 hours ago") for a recent page and a date ("Nov 5, 2026")
 * for an older one; " ... " separates it from the snippet.
 */
export function ageOf(snippet: string, now: Date): { postedAt: Date; rest: string } | undefined {
  const relative = snippet.match(/^(\d+) (minute|hour|day|week)s? ago(?: \.\.\. ?|$)/);
  if (relative?.[1] && relative[2]) {
    const ms = unitMs[relative[2]];
    if (ms === undefined) return undefined;
    return {
      postedAt: new Date(now.getTime() - Number(relative[1]) * ms),
      rest: snippet.slice(relative[0].length).trim(),
    };
  }

  const dated = snippet.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})(?: \.\.\. ?|$)/);
  const month = dated?.[1] ? months.indexOf(dated[1]) : -1;
  if (dated?.[2] && dated[3] && month !== -1) {
    return {
      postedAt: new Date(Date.UTC(Number(dated[3]), month, Number(dated[2]))),
      rest: snippet.slice(dated[0].length).trim(),
    };
  }

  return undefined;
}

/**
 * A group post's address in any of Facebook's forms, as its group and post
 * id. The id is the one a group read gives the same post, so a post found
 * both ways is one post. `pfbid…` and profile links are not posts in a group.
 */
export function groupPostOf(address: string): { group: string; id: string } | undefined {
  const match = address.match(
    /^https:\/\/(?:www\.|m\.|web\.)?facebook\.com\/groups\/([^/?#]+)\/(?:posts|permalink)\/(\d+)/,
  );
  if (!match?.[1] || !match[2]) return undefined;
  try {
    return { group: decodeURIComponent(match[1]), id: match[2] };
  } catch {
    return undefined;
  }
}

/** Google's title, without the " - Facebook" it adds to most. */
function titleOf(value: string): string {
  return value.replace(/ - Facebook$/, "").trim();
}

/** One search result to a partial post: see the header. */
export function toSearchPost(record: unknown, now: Date): CandidatePost | undefined {
  const result = objectOf(record);
  const address = text(result?.url);
  const where = address ? groupPostOf(address) : undefined;
  const snippet = text(result?.description);
  const age = snippet ? ageOf(snippet, now) : undefined;
  if (!where || !age) return undefined;

  const title = text(result?.title) ? titleOf(String(result?.title)) : "";
  const body = age.rest || title;
  if (!body) return undefined;

  return {
    externalId: where.id,
    url: `https://www.facebook.com/groups/${where.group}/posts/${where.id}/`,
    channel: where.group,
    ...(title ? { title } : {}),
    text: body,
    postedAt: age.postedAt,
    postedAtIsApproximate: true,
    // No `since`: Google shows a post hours after it is written, so a post
    // older than the poll's window is still one this monitor has not seen.
    partial: {},
  };
}

/** One post read by its address, whole. A post with no id, date or words is undefined. */
export function toReadPost(
  record: Record<string, unknown>,
  address: string,
): CandidatePost | undefined {
  const where = groupPostOf(text(record.url) ?? address) ?? groupPostOf(address);
  const externalId = text(record.post_id) ?? where?.id;
  const body = text(record.description);
  const created = text(record.creation_time);
  const postedAt = created ? new Date(created) : undefined;
  if (!where || !externalId || !body || !postedAt || Number.isNaN(postedAt.getTime())) {
    return undefined;
  }

  const author = text(objectOf(record.author)?.name);
  const replyCount = countOf(record.comment_count);

  return {
    externalId,
    url: `https://www.facebook.com/groups/${where.group}/posts/${externalId}/`,
    ...(author ? { author } : {}),
    text: body,
    postedAt,
    channel: where.group,
    ...(replyCount === undefined ? {} : { replyCount }),
  };
}

/**
 * One record of a group's page to one `CandidatePost`. A post with no id, URL,
 * date or text is dropped: a photo or a video has nothing to score.
 */
export function toCandidatePost(record: unknown, group: string): CandidatePost | undefined {
  const post = objectOf(record);
  if (!post) return undefined;

  const externalId = text(post.id);
  const url = text(post.url);
  const body = text(post.text);
  const postedAt = dateOfSeconds(post.publishTime);

  if (!externalId || !url || !body || !postedAt) return undefined;

  const author = text(objectOf(post.author)?.name);
  const channel = groupOf(group);
  const replyCount = countOf(post.commentCount);

  return {
    externalId,
    url,
    ...(author ? { author } : {}),
    text: body,
    postedAt,
    ...(channel ? { channel } : {}),
    ...(replyCount === undefined ? {} : { replyCount }),
  };
}
