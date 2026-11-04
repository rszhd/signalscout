/**
 * Public Facebook groups through ScrapeCreators. US-516.
 *
 * A group is read by address, not searched, so each query is the full address
 * of one public group. One request reads one page of three or four posts, and
 * a group may be paged back to `since` within a cap.
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
  ScrapeCreatorsClient,
  ScrapeCreatorsError,
} from "./client.js";
import { scrapeCreatorsProvider } from "./provider.js";

/** The default page cap for one group in one poll. */
export const maxPagesPerGroup = 5;

/** The price of one request, as every endpoint on this key is priced. */
const pricePerUnitMicros = 1880;
/** Three posts is the smallest page measured for this endpoint. */
const postsPerUnit = 3;

export interface FacebookOptions {
  /** Pages one group may read in one poll: a whole number from 1 to 5. */
  readonly pagesPerGroup?: number;
}

/**
 * The connector, reading at most `pagesPerGroup` pages of one group a poll.
 * An application sets a lower cap to spend less per group.
 */
export function createScrapeCreatorsFacebook(options: FacebookOptions = {}): ConnectorDefinition {
  const pagesPerGroup = options.pagesPerGroup ?? maxPagesPerGroup;

  if (!Number.isInteger(pagesPerGroup) || pagesPerGroup < 1 || pagesPerGroup > maxPagesPerGroup) {
    throw new RangeError(
      `pagesPerGroup must be a whole number from 1 to ${maxPagesPerGroup}, not ${pagesPerGroup}`,
    );
  }

  return {
    platform: facebookPlatform,
    provider: scrapeCreatorsProvider,
    billableUnit: "request",
    pricePerUnitMicros,
    postsPerUnit,
    discovery: ["channel"],
    linksToComments: false,
    canFetchReplies: false,
    maxUnitsPerQueryPoll: pagesPerGroup,
    create: (runtime) => new ScrapeCreatorsFacebookSource(runtime, pagesPerGroup),
  };
}

export const scrapeCreatorsFacebook: ConnectorDefinition = createScrapeCreatorsFacebook();

/** Where the caller is. A cursor names a group and the pages read from it. */
interface Cursor {
  readonly index: number;
  readonly pages: number;
  readonly after?: string;
  /** Post ids already returned for this group in this read. */
  readonly seen?: readonly string[];
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
  readonly discovery = ["channel"] as const;
  readonly linksToComments = false;
  readonly canFetchReplies = false;
  readonly maxUnitsPerQueryPoll: number;

  constructor(
    private readonly runtime: SourceRuntime,
    private readonly pagesPerGroup = maxPagesPerGroup,
  ) {
    this.maxUnitsPerQueryPoll = pagesPerGroup;
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
    const start =
      request.cursor === undefined ? this.first(request.query) : decodeCursor(request.cursor);

    if (!start) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    const query = request.query.queries[start.index];

    // The monitor's queries changed between two polls. Finishing is safe: the
    // next poll starts again from the first query.
    if (query === undefined) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

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
          next: this.afterGroup(request.query, start),
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

    return this.afterGroup(query, at);
  }

  private first(query: SourceQuery): Cursor | undefined {
    return query.queries.length > 0 ? { index: 0, pages: 0 } : undefined;
  }

  private afterGroup(query: SourceQuery, at: Cursor): SearchResult["next"] {
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
