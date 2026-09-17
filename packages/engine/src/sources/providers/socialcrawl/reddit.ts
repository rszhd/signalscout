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
 * **It reads replies since US-159, and it is the expensive half of a real
 * choice rather than the cheap one.** US-020 measured this endpoint at 5
 * credits against ScrapeCreators' 1 and left it unbuilt; what changed is that
 * an instance whose only Reddit key is this provider's was then given no
 * replies at all, and told nothing.
 *
 * The capture on 2026-09-17 says what the five credits buy. One call returned
 * **34 of the 34 comments the post claimed**, nested five levels deep, with no
 * cursor and `truncated: false`. ScrapeCreators buys a flat page of 25 for one
 * credit and has been measured stopping at 43 of 95 while reporting itself
 * finished. So the two are not the same product at different prices:
 *
 * * ScrapeCreators: $0.00188 for the top of a thread, and no way to reach the
 *   rest.
 * * SocialCrawl: $0.0406 for the thread, whole, in one call.
 *
 * On the median subreddit thread of about twelve comments the cheap one is
 * complete too, and buying this instead is paying twenty-two times for the
 * same words. The monitor form states the per-platform price, and the choice
 * stays the person's.
 */
import { redditPlatform } from "../../platforms.js";
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
  redditCommentsProfile,
  redditSearchProfile,
  redditSubredditProfile,
  redditSubredditSearchProfile,
  SocialCrawlClient,
  SocialCrawlError,
} from "./client.js";
import { toCandidateReply } from "./comments.js";
import { socialCrawlProvider } from "./provider.js";

/** The most pages one input may buy in one poll. A page is about 25 posts. */
const maxPagesPerInput = 2;

export const socialCrawlReddit: ConnectorDefinition = {
  platform: redditPlatform,
  provider: socialCrawlProvider,
  billableUnit: "request",
  /** The same credit as X, LinkedIn and YouTube: one provider, one pack. */
  pricePerUnitMicros: 8118,
  /** About 25 posts a request, the page size measured for this endpoint. */
  postsPerUnit: 25,
  /**
   * Both — and uniquely, both at once. `/v1/reddit/subreddit/search` is a
   * keyword *inside* a subreddit, which no other Reddit connector has, and it
   * is the reason this expensive one exists. US-031.
   */
  discovery: ["keyword", "channel"],
  maxUnitsPerQueryPoll: maxPagesPerInput,
  /**
   * True since US-159, and the dearest reply call in this product.
   *
   * Five credits against ScrapeCreators' one, and a whole nested thread
   * against the top of one. The header says which is worth buying when; the
   * monitor form says what it costs before a person ticks the box.
   */
  canFetchReplies: true,
  /** Five credits a call, where every search endpoint here is one. */
  replyPricePerUnitMicros: 5 * 8118,
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
  readonly replyPricePerUnitMicros = socialCrawlReddit.replyPricePerUnitMicros;

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
  /**
   * The whole thread under one post, in one call. US-159.
   *
   * **This is the only reply call in this product that is not a page.** The
   * provider expands the nesting itself and answers with a tree: 34 of 34
   * claimed comments, five levels deep, no cursor, `has_more: false`. So the
   * cursor handling below is there because the envelope has the field, not
   * because a captured answer ever used it.
   *
   * The five credits are spent whatever the thread holds, which is what makes
   * this the wrong connector for a subreddit of short threads and the right
   * one for a monitor that needs the conversation rather than the top of it.
   */
  async fetchReplies(request: ReplyRequest): Promise<ReplyResult> {
    const page = await this.client(request.credentials, redditCommentsProfile).fetchPage(
      {
        url: request.postUrl,
        ...(request.cursor ? { cursor: request.cursor } : {}),
      },
      request.signal,
    );

    /**
     * Depth first, because that is the order a person reads a thread in.
     *
     * `threadPosition` is the provider's own order and US-048 will ask what it
     * is worth, so the walk must be the one the provider laid out rather than
     * a re-sort of it. A reply sits immediately under the comment it answers,
     * which is where its parent's words are.
     */
    // Every comment carries its own `url`, and one from this capture was
    // opened on 2026-09-17: it lands on the thread with that comment first.
    const flattened = flatten(page.records);

    const parsed = flattened
      .map((record, index) =>
        toCandidateReply(record, {
          parentPostExternalId: request.postExternalId,
          position: (request.positionOffset ?? 0) + index,
        }),
      )
      .filter((reply): reply is CandidateReply => reply !== undefined);

    /**
     * The window, applied to every comment and used to stop nothing.
     *
     * A tree is not in date order and cannot be: a fresh reply hangs under a
     * comment from last year, and the walk meets the old one first. So there
     * is no early stop to make here, and the five credits were spent before
     * the first date was read either way.
     */
    const replies = request.since
      ? parsed.filter((reply) => reply.postedAt > (request.since as Date))
      : parsed;

    return {
      replies,
      /**
       * The provider's count, and for this endpoint that is the flattened
       * tree rather than `data.items`. Eight items arrived and 34 comments
       * came with them; a caller told "eight" would set the next walk's
       * positions 26 places too low.
       */
      itemsReturned: flattened.length,
      unitsConsumed: page.creditsUsed,
      next: page.cursor ? { status: "ready", cursor: page.cursor } : { status: "done" },
      /**
       * `truncated` is believed here, and it is the one completeness claim in
       * this repository that has been measured right.
       *
       * Three have been measured wrong: ScrapeCreators' Reddit `has_more:
       * false` with 33 comments missing, its X cursor leading to an empty
       * page, and Instagram's `has_more` beside a page of nothing. This one
       * said `false` on a thread where all 34 claimed comments arrived.
       *
       * It is believed because the alternative costs real money. A thread
       * recorded partial is re-opened on every poll for ever, and here that is
       * five credits each time — so answering "partial" out of caution would
       * turn one honest call into an unbounded bill. One thread is one
       * measurement, and a second capture disagreeing is what would change
       * this line.
       */
      partial: page.truncated === true || page.cursor !== undefined,
    };
  }

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

/**
 * A tree of comments to a flat list, depth first.
 *
 * This endpoint is the only one in the product whose answer nests. Every
 * comment carries a `replies` array of the same shape, and the captured thread
 * used five levels of it: eight items at the top, 34 comments in total.
 *
 * The nesting is dropped rather than kept, because nothing downstream reads a
 * tree. A reply is stored as its own row and its place in the conversation is
 * `parent_id`, which every captured comment carries and which the shared
 * parser already reads. Flattening loses no link.
 *
 * Depth is bounded, because a cycle in somebody else's data must not be an
 * unbounded walk here. Reddit's own limit is far below this; the number exists
 * so a malformed answer ends the walk instead of the process.
 */
export function flatten(records: readonly unknown[], depth = 0): readonly unknown[] {
  if (depth > 20) return [];

  const out: unknown[] = [];

  for (const record of records) {
    const item = objectOf(record);
    if (!item) continue;

    const comment = objectOf(item.comment) ?? item;
    out.push(record);

    const children = comment.replies;
    if (Array.isArray(children) && children.length > 0) {
      out.push(...flatten(children, depth + 1));
    }
  }

  return out;
}
