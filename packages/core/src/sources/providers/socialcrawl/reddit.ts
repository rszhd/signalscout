/**
 * Reddit, fetched through SocialCrawl. US-031.
 *
 * The third provider for Reddit, and the only one of the three that can search
 * *inside* a subreddit. That endpoint is the whole reason this connector
 * exists, because US-022 measured the gap it fills: a keyword across all of
 * Reddit brings back noise, and a subreddit on its own ignores the monitor's
 * words entirely.
 *
 * **The capture measured that gap again, harder.** On 2026-09-06, one credit
 * each:
 *
 * * `/v1/reddit/search` for `flaky tests` returned 25 posts from r/TIdaL,
 *   r/RedditLaqueristaSwap, r/Euphoria_HBO, r/AskVet and r/snapmaker. A watch
 *   app's audio output was "still flaky with 3+ devices". A dog had a skin
 *   issue.
 * * `/v1/reddit/subreddit/search` for the same words inside r/softwaretesting
 *   returned 7 posts, **every one on topic and every one from that subreddit**.
 *
 * So this connector prefers the scoped mode wherever a monitor names both a
 * query and a channel, and the plain keyword search is the fallback rather
 * than the default. That is the opposite of the other two Reddit connectors,
 * and it is a measurement rather than a taste.
 *
 * **It is the expensive one and it has to earn that.** A credit is 8,118
 * micro-dollars against a ScrapeCreators request's 1,880, so every call costs
 * 4.3 times its equivalent. It buys precision, not volume: seven right posts
 * against twenty-five wrong ones.
 *
 * **It does not read replies, and that is deliberate.** SocialCrawl's Reddit
 * comment endpoint is 5 credits against ScrapeCreators' 1 for the same thread,
 * measured in US-020. A deployment that wants Reddit replies uses
 * ScrapeCreators, and the monitor form says so per platform rather than
 * leaving somebody to find out.
 */
import { redditPlatform } from "../../platforms.js";
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
  redditSearchProfile,
  redditSubredditProfile,
  redditSubredditSearchProfile,
  SocialCrawlClient,
  SocialCrawlError,
} from "./client.js";
import { socialCrawlProvider } from "./provider.js";

/** The most pages one input may buy in one poll. A page is about 25 posts. */
const maxPagesPerInput = 2;

export const socialCrawlReddit: ConnectorDefinition = {
  platform: redditPlatform,
  provider: socialCrawlProvider,
  billableUnit: "request",
  /** The same credit as X, LinkedIn and YouTube: one provider, one pack. */
  pricePerUnitMicros: 8118,
  maxUnitsPerQueryPoll: maxPagesPerInput,
  /**
   * False, and measured rather than unimplemented. Its comment endpoint works
   * and costs 5 credits where ScrapeCreators' costs 1 — US-020 compared them on
   * one thread. Reddit replies belong to the cheaper provider.
   */
  canFetchReplies: false,
  create: (runtime) => new SocialCrawlRedditSource(runtime),
};

/**
 * Three discovery modes, in the order a monitor gets value from them.
 *
 * `scoped` is a keyword inside one subreddit and it is this provider's reason
 * to exist. `subreddit` is everything recent in a channel. `keyword` is a
 * search across all of Reddit, and the capture showed what that returns — so
 * it runs only when a monitor named no channel at all.
 */
const phases = ["scoped", "subreddit", "keyword"] as const;
type Phase = (typeof phases)[number];

/**
 * Where the caller is. `index` walks the inputs of the current phase, and for
 * the scoped phase one input is a (query, channel) pair.
 */
interface Cursor {
  readonly phase: Phase;
  readonly index: number;
  readonly pages: number;
  readonly after?: string;
}

const cursorSeparator = "|";

function encodeCursor({ phase, index, pages, after }: Cursor): string {
  return [phase, index, pages, after ?? ""].join(cursorSeparator);
}

function decodeCursor(cursor: string): Cursor {
  const parts = cursor.split(cursorSeparator);
  const [phase, rawIndex, rawPages] = parts;
  const index = Number(rawIndex);
  const pages = Number(rawPages);
  const after = parts.slice(3).join(cursorSeparator);

  if (
    parts.length < 4 ||
    !phases.includes(phase as Phase) ||
    !Number.isInteger(index) ||
    index < 0 ||
    !Number.isInteger(pages) ||
    pages < 0
  ) {
    throw new Error(`${redditPlatform.id}: cursor "${cursor}" was not issued by this source.`);
  }

  return { phase: phase as Phase, index, pages, ...(after ? { after } : {}) };
}

/** One unit of work: which endpoint, and what to ask it. */
interface Input {
  readonly profile: typeof redditSearchProfile;
  readonly params: Record<string, string>;
}

export class SocialCrawlRedditSource implements SocialSource {
  readonly platform = socialCrawlReddit.platform;
  readonly provider = socialCrawlReddit.provider;
  readonly billableUnit = socialCrawlReddit.billableUnit;
  readonly pricePerUnitMicros = socialCrawlReddit.pricePerUnitMicros;
  readonly maxUnitsPerQueryPoll = socialCrawlReddit.maxUnitsPerQueryPoll;
  readonly canFetchReplies = socialCrawlReddit.canFetchReplies;

  constructor(private readonly runtime: SourceRuntime) {}

  private client(
    credentials: SourceCredentials,
    profile: typeof redditSearchProfile,
  ): SocialCrawlClient {
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
      await this.client(credentials, redditSearchProfile).probe();
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

    const input = this.inputAt(request.query, start);

    // The cursor points past the end of what this monitor names, which happens
    // when its queries were edited between two polls. Finishing is the safe
    // answer: the next poll starts again from the first input.
    if (!input) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    let page: Page;

    try {
      page = await this.client(request.credentials, input.profile).fetchPage(
        { ...input.params, ...(start.after ? { cursor: start.after } : {}) },
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
   * Every unit of work this monitor implies, in phase order.
   *
   * The scoped phase is a cross product, and it is bounded by nothing here on
   * purpose: `maxPagesPerInput` bounds one input and the caller's own poll
   * budget bounds the walk. A monitor with eight queries and five subreddits
   * asks for forty pairs, and the poll stops when it stops.
   */
  private inputsFor(query: SourceQuery, phase: Phase): Input[] {
    const { queries, channels } = query;
    const bare = (channel: string) => channel.replace(/^\/?r\//, "");

    if (phase === "scoped") {
      // Only when a monitor named both. This is the mode worth paying for.
      if (queries.length === 0 || channels.length === 0) return [];

      return channels.flatMap((channel) =>
        queries.map((term) => ({
          profile: redditSubredditSearchProfile,
          params: { subreddit: bare(channel), query: term, sort: "new" },
        })),
      );
    }

    if (phase === "subreddit") {
      // Skipped when the scoped phase already covered these channels: asking
      // for everything recent in a subreddit we just searched by keyword buys
      // the noise the keyword was there to avoid.
      if (queries.length > 0) return [];

      return channels.map((channel) => ({
        profile: redditSubredditProfile,
        params: { subreddit: bare(channel), sort: "new" },
      }));
    }

    /**
     * A keyword across all of Reddit, and only when there is no channel.
     *
     * The capture is why this is last and conditional: `flaky tests` returned
     * posts from r/TIdaL, r/AskVet and r/RedditLaqueristaSwap, because "flaky"
     * describes a Bluetooth connection and a dog as readily as a test suite.
     */
    if (channels.length > 0) return [];

    return queries.map((term) => ({
      profile: redditSearchProfile,
      params: { query: term, sort: "new" },
    }));
  }

  private inputAt(query: SourceQuery, at: Cursor): Input | undefined {
    return this.inputsFor(query, at.phase)[at.index];
  }

  private first(query: SourceQuery): Cursor | undefined {
    for (const phase of phases) {
      if (this.inputsFor(query, phase).length > 0) return { phase, index: 0, pages: 0 };
    }
    return undefined;
  }

  private nextAfter(query: SourceQuery, at: Cursor, page: Page): SearchResult["next"] {
    const pages = at.pages + 1;

    if (page.cursor !== undefined && pages < maxPagesPerInput) {
      return { status: "ready", cursor: encodeCursor({ ...at, pages, after: page.cursor }) };
    }

    const nextIndex = at.index + 1;

    if (nextIndex < this.inputsFor(query, at.phase).length) {
      return {
        status: "ready",
        cursor: encodeCursor({ phase: at.phase, index: nextIndex, pages: 0 }),
      };
    }

    for (const phase of phases.slice(phases.indexOf(at.phase) + 1)) {
      if (this.inputsFor(query, phase).length > 0) {
        return { status: "ready", cursor: encodeCursor({ phase, index: 0, pages: 0 }) };
      }
    }

    return { status: "done" };
  }
}

/**
 * One record to one `CandidatePost`.
 *
 * The provider wraps every platform in one envelope, so this reads the same
 * `{ post: { id, url, content, author, published_at, ext } }` the X and
 * YouTube connectors do. What is Reddit's own sits in `ext`: the subreddit,
 * and the title and body as separate fields where `content.text` joins them.
 */
export function toCandidatePost(record: unknown): CandidatePost | undefined {
  const item = objectOf(record);
  const post = objectOf(item?.post) ?? item;
  if (!post) return undefined;

  const id = text(post.id);
  const url = text(post.url);
  const postedAt = dateOf(post.published_at);
  const body = text(objectOf(post.content)?.text);

  if (!id || !url || !postedAt || !body) return undefined;

  const ext = objectOf(post.ext);
  const author = objectOf(post.author);
  const engagement = objectOf(post.engagement);
  const comments = engagement?.comments;

  /**
   * Reddit's own `t3_` fullname, rebuilt from the bare id.
   *
   * Deduplication is keyed by it, and the other two Reddit connectors both
   * report it — Bright Data as `post_id`, ScrapeCreators as `name`. This
   * provider gives the bare id, so the prefix is added here rather than
   * letting one provider's copy of a post fail to match another's.
   */
  const externalId = id.startsWith("t3_") ? id : `t3_${id}`;

  return {
    externalId,
    url,
    text: body,
    postedAt,
    ...(text(ext?.title) ? { title: text(ext?.title) } : {}),
    ...(text(ext?.subreddit) ? { channel: text(ext?.subreddit) } : {}),
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
