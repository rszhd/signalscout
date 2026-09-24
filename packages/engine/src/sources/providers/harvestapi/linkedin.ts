/**
 * LinkedIn, fetched from HarvestAPI directly.
 *
 * Correctness-critical: cursor and deduplication. The failure this file must
 * avoid is a post stored twice, and a request billed for nothing. The first
 * is prevented by the id: `id` is the activity id, the number the Apify
 * connector stores, so a deployment that changes provider keeps one row per
 * post. The second is prevented by reading one page per query per poll.
 *
 * **The wire shape is the Apify actor's**, because the actor is this
 * provider's own product. The capture confirmed it field by field, so the
 * post and comment parsers are imported from `../apify/linkedin.ts` rather
 * than copied: a change LinkedIn forces on one is a change to both.
 *
 * Three measured facts decide the shape below (US-386):
 *
 * 1. **A request is $0.004, whatever it returns.** An empty search costs the
 *    same as a full one, so the unit is the request.
 * 2. **A page holds fifty posts**, and page 2 repeats none of page 1.
 * 3. **`sortBy=date` selects recent posts but does not order them**, the same
 *    as the actor. No page may be read as older than the next, so there is no
 *    early stop, and one page is the whole of a query's poll.
 */
import { linkedInPlatform } from "../../platforms.js";
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
import { flattenComments, toCandidatePost, toCandidateReply } from "../apify/linkedin.js";
import { HarvestApiClient, HarvestApiError } from "./client.js";
import { harvestApiProvider } from "./provider.js";

/**
 * One page a query a poll. Fifty posts is twice what the Apify connector buys,
 * and a second page would double the bill for posts older than the first
 * fifty, which a poll that runs again tomorrow does not need.
 */
const pagesPerQuery = 1;

/** Measured on every captured search page. */
const postsPerPage = 50;

export const harvestApiLinkedIn: ConnectorDefinition = {
  platform: linkedInPlatform,
  provider: harvestApiProvider,
  /**
   * The request, because that is what moved the balance: $0.004 each, with
   * fifty posts, with none, and for a page of comments.
   */
  billableUnit: "request",
  /**
   * 4,000 micro-dollars: the $20 Starter top-up, 5,000 requests. Larger
   * top-ups are cheaper, down to $0.002; the dearest price goes here for the
   * reason every connector gives — a person told they spent more than they did
   * stops early, and a person told the reverse spends past their cap.
   */
  pricePerUnitMicros: 4000,
  postsPerUnit: postsPerPage,
  discovery: ["keyword"],
  maxUnitsPerQueryPoll: pagesPerQuery,
  /**
   * Comments carry an id, a link that opens the comment, the words, an exact
   * date and an author — the actor's shape, read by the actor's parser. One
   * page holds up to a hundred and costs one request.
   */
  canFetchReplies: true,
  replyPricePerUnitMicros: 4000,
  create: (runtime) => new HarvestApiLinkedInSource(runtime),
};

/**
 * The windows LinkedIn itself applies, narrowest first. The provider's
 * documentation names these three for `postedLimit`; a longer window is sent
 * as none. `24h` narrowed a live search from 273 results to 158.
 */
const windows = [
  { value: "24h", covers: 24 * 60 * 60 * 1000 },
  { value: "week", covers: 7 * 24 * 60 * 60 * 1000 },
  { value: "month", covers: 31 * 24 * 60 * 60 * 1000 },
] as const;

/** The cursor is the index of the next query. There is nothing else to hold. */
function decodeCursor(cursor: string): number {
  const index = Number(cursor);

  // A cursor the caller invented, not one we issued. Reading it as an empty
  // page would report the query finished and lose everything after it.
  if (cursor === "" || !Number.isInteger(index) || index < 0) {
    throw new Error(`${linkedInPlatform.id}: cursor "${cursor}" was not issued by this source.`);
  }

  return index;
}

export class HarvestApiLinkedInSource implements SocialSource {
  readonly platform = harvestApiLinkedIn.platform;
  readonly provider = harvestApiLinkedIn.provider;
  readonly billableUnit = harvestApiLinkedIn.billableUnit;
  readonly pricePerUnitMicros = harvestApiLinkedIn.pricePerUnitMicros;
  readonly maxUnitsPerQueryPoll = harvestApiLinkedIn.maxUnitsPerQueryPoll;
  readonly canFetchReplies = harvestApiLinkedIn.canFetchReplies;
  readonly replyPricePerUnitMicros = harvestApiLinkedIn.replyPricePerUnitMicros;

  constructor(private readonly runtime: SourceRuntime) {}

  private client(credentials: SourceCredentials): HarvestApiClient {
    const apiKey = credentials.apiKey;
    if (!apiKey) {
      throw new HarvestApiError("credentials", "No HarvestAPI key was given.", 0);
    }
    return new HarvestApiClient({ runtime: this.runtime, apiKey });
  }

  /** Reads the account, which costs nothing. docs/secrets.md, *Testing before storing*. */
  async validateCredentials(credentials: SourceCredentials): Promise<CredentialCheck> {
    if (!credentials.apiKey) {
      return { valid: false, reason: "Enter your HarvestAPI key." };
    }

    try {
      await this.client(credentials).probe();
    } catch (error) {
      if (
        error instanceof HarvestApiError &&
        (error.kind === "credentials" || error.kind === "balance")
      ) {
        return { valid: false, reason: error.message };
      }
      throw error;
    }

    return { valid: true };
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    const client = this.client(request.credentials);
    const index = request.cursor === undefined ? 0 : decodeCursor(request.cursor);

    if (request.cursor === undefined && request.query.channels.length > 0) {
      this.runtime.logger.debug(
        { platform: linkedInPlatform.id, channels: request.query.channels.length },
        "LinkedIn channels are not searched: this endpoint takes keywords and author URLs.",
      );
    }

    const query = request.query.queries[index];

    // No query, or a cursor past the end because the monitor's queries were
    // edited between two polls. Finishing is the safe answer.
    if (query === undefined) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    let records: readonly unknown[];

    try {
      ({ records } = await client.searchPosts(
        { search: query, sortBy: "date", ...this.window(request.query.since) },
        request.signal,
      ));
    } catch (error) {
      if (error instanceof HarvestApiError && error.kind === "rateLimit") {
        return {
          posts: [],
          unitsConsumed: 0,
          next: {
            status: "wait",
            retryAfter: error.retryAfter ?? new Date(this.runtime.now().getTime() + 60_000),
            cursor: String(index),
          },
        };
      }
      throw error;
    }

    const wanted = records
      .map((record) => toCandidatePost(record))
      .filter((post): post is CandidatePost => post !== undefined)
      // The exact cut. `postedLimit` is a named range, and LinkedIn applies it.
      .filter((post) => !request.query.since || post.postedAt > request.query.since);

    const posts = request.limit === undefined ? wanted : wanted.slice(0, request.limit);

    return {
      posts,
      foundBy: { kind: "query", value: query },
      unitsConsumed: 1,
      next: this.advance(request.query, index),
    };
  }

  /**
   * The comments under one post: one page, newest first, up to a hundred.
   *
   * One page and then done, and `partial` when the provider said there were
   * more. Page 2 of comments was never captured, and a page nobody has seen
   * is not something to spend a person's money on.
   */
  async fetchReplies(request: ReplyRequest): Promise<ReplyResult> {
    const page = await this.client(request.credentials).postComments(
      { post: request.postUrl, sortBy: "date" },
      request.signal,
    );

    // Depth first, carrying each comment's id down to the replies under it: a
    // nested reply names no parent of its own.
    const flattened = flattenComments(page.records);

    const parsed = flattened
      .map(({ record, parentReplyExternalId }, index) =>
        toCandidateReply(record, {
          parentPostExternalId: request.postExternalId,
          position: (request.positionOffset ?? 0) + index,
          ...(parentReplyExternalId ? { parentReplyExternalId } : {}),
        }),
      )
      .filter((reply): reply is CandidateReply => reply !== undefined);

    const replies = request.since
      ? parsed.filter((reply) => reply.postedAt > (request.since as Date))
      : parsed;

    return {
      replies,
      itemsReturned: flattened.length,
      unitsConsumed: 1,
      next: { status: "done" },
      partial: (page.totalPages ?? 1) > 1,
    };
  }

  private advance(query: SourceQuery, index: number): SearchResult["next"] {
    const next = index + 1;
    return next < query.queries.length
      ? { status: "ready", cursor: String(next) }
      : { status: "done" };
  }

  /**
   * The narrowest window that still covers everything the caller asked for.
   * Widening rather than narrowing: too narrow silently loses posts, and the
   * cut in `search` is exact in any case.
   */
  private window(since: Date | undefined): Record<string, string> {
    if (!since) return {};

    const age = this.runtime.now().getTime() - since.getTime();
    const window = windows.find((candidate) => age <= candidate.covers);

    return window ? { postedLimit: window.value } : {};
  }
}
