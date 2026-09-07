/**
 * Reddit, reached through ScrapeCreators.
 *
 * Correctness-critical: cursor and deduplication. The failure this file has to
 * avoid is the same post fetched and billed twice. ScrapeCreators bills one
 * credit per request, so a connector that loses its place pays again for a
 * page it already has. The cursor below is what stops that, and
 * `reddit.test.ts` pins it.
 *
 * This file is one connector: the Reddit platform and the ScrapeCreators
 * provider, and the price that pair bills. The platform is described in
 * `sources/platforms.ts` and the provider in `./provider.ts`, so this file
 * edits neither of them and neither knows it exists.
 *
 * It is the second connector for Reddit. Nothing downstream learns which
 * provider answered: a post collected here and a post collected through Bright
 * Data are one row in `posts`, because that table is keyed by the platform.
 * STACK.md, *A source is not a provider*.
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
  VerificationRequest,
  VerificationResult,
} from "../../types.js";
import type { Page } from "./client.js";
import { endpoints, ScrapeCreatorsClient, ScrapeCreatorsError, sortNewest } from "./client.js";
import { scrapeCreatorsProvider } from "./provider.js";

/**
 * How many pages one keyword or one subreddit may cost in a single poll.
 *
 * Every page is a credit, and a query with a deep history could otherwise page
 * until the month's cap stopped it. Two pages collected 14 posts on a keyword
 * and 46 on a subreddit in the capture run — enough for one poll of one input,
 * and a cheap mistake if it is the wrong number.
 *
 * The budget guard reads it as `maxUnitsPerQueryPoll`, and US-014's cost test
 * multiplies it by the polls in a month. It is the ceiling of that arithmetic,
 * so raising it raises every projected bill.
 */
const maxPagesPerInput = 2;

export const scrapeCreatorsReddit: ConnectorDefinition = {
  platform: redditPlatform,
  provider: scrapeCreatorsProvider,
  /**
   * ScrapeCreators bills one credit per request, whatever the request returns.
   * One credit bought 7 posts on a keyword search and 23 on a subreddit in the
   * same capture run, which is exactly why `unitsConsumed` can never be a post
   * count — and why this connector is cheap where Bright Data, which bills per
   * record, is not.
   */
  billableUnit: "request",
  /**
   * $1.88 per 1,000 credits: the $47 pack of 25,000, read from
   * scrapecreators.com on 2026-09-05.
   *
   * The larger pack is $497 for 500,000, which is 994 micro-dollars. The
   * smaller number is the one a new self-hoster pays, and over-reporting a
   * bill is the safe direction for a guard whose job is to refuse: a person on
   * the larger pack is told they spent more than they did, and stops early. A
   * person told the reverse spends past their cap.
   */
  pricePerUnitMicros: 1880,
  /**
   * Seven, the keyword figure, not the subreddit's twenty-three.
   *
   * One credit bought 7 posts on a keyword search and 23 on a subreddit in the
   * same capture run on 2026-09-05. Declaring the smaller means a person
   * comparing providers is told this one costs more per post than it may, which
   * is the safe direction — and the two modes really are that far apart, which
   * is worth knowing before choosing a discovery mode.
   */
  postsPerUnit: 7,
  /** `maxPagesPerInput`: what one keyword or subreddit costs in one poll. */
  maxUnitsPerQueryPoll: maxPagesPerInput,
  canFetchReplies: true,
  /** A comment page is one credit, the same as a search. Measured, not assumed. */
  replyPricePerUnitMicros: 1880,
  create: (runtime) => new ScrapeCreatorsRedditSource(runtime),
};

/**
 * Keywords and subreddits are two discovery modes, and one request carries one
 * input from one of them. A monitor may name both, so the connector walks
 * them in turn.
 */
const phases = ["keyword", "subreddit"] as const;
type Phase = (typeof phases)[number];

/**
 * Where the caller is: which phase, which input inside it, how many pages of
 * that input this poll has already bought, and the provider's own cursor.
 *
 * All four are load-bearing. The phase lets a monitor that named both keywords
 * and subreddits reach its subreddits at all. The index stops the second poll
 * re-reading the first keyword for ever. The page count is what
 * `maxPagesPerInput` is counted against, so one input cannot spend a poll's
 * whole budget. And `after` is the provider's place inside one input — without
 * it the next call buys page one again, which is the same posts at full price.
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

/**
 * The provider's cursor is a long base64 blob on search and a `t3_` fullname
 * on a subreddit. Neither contains the separator, but rejoining the tail
 * rather than reading one field means a provider that starts using it cannot
 * silently truncate our place in the collection.
 */
function decodeCursor(cursor: string): Cursor {
  const parts = cursor.split(cursorSeparator);
  const [phase, rawIndex, rawPages] = parts;
  const index = Number(rawIndex);
  const pages = Number(rawPages);
  const after = parts.slice(3).join(cursorSeparator);

  // A cursor the caller invented, not one we issued. Reading it as an empty
  // page would report the query finished and lose everything after it.
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

export class ScrapeCreatorsRedditSource implements SocialSource {
  readonly platform = scrapeCreatorsReddit.platform;
  readonly provider = scrapeCreatorsReddit.provider;
  readonly billableUnit = scrapeCreatorsReddit.billableUnit;
  readonly pricePerUnitMicros = scrapeCreatorsReddit.pricePerUnitMicros;
  readonly maxUnitsPerQueryPoll = scrapeCreatorsReddit.maxUnitsPerQueryPoll;
  // The declaration has to reach the instance, not only the definition: every
  // screen and every step asks the connector the registry built, not the
  // record it was built from.
  readonly canFetchReplies = scrapeCreatorsReddit.canFetchReplies;
  readonly replyPricePerUnitMicros = scrapeCreatorsReddit.replyPricePerUnitMicros;

  constructor(private readonly runtime: SourceRuntime) {}

  verify(request: VerificationRequest): Promise<VerificationResult> {
    return this.client(request.credentials).verify(request);
  }

  private client(credentials: SourceCredentials): ScrapeCreatorsClient {
    const apiKey = credentials.apiKey;
    if (!apiKey) {
      throw new ScrapeCreatorsError("credentials", "No ScrapeCreators API key was given.", 0);
    }
    return new ScrapeCreatorsClient({ runtime: this.runtime, apiKey });
  }

  /**
   * Check a key without spending anything.
   *
   * The client's probe sends a search with no query, which the provider
   * refuses on the parameter after it has accepted the key. Both answers were
   * captured and both charged nothing, so a person can save their settings
   * without being billed for finding out they typed the key correctly.
   *
   * A refusal and an unreachable provider are different answers, and this
   * returns the first while throwing the second: they lead to different
   * actions, and a person whose provider is down must not be told to replace a
   * working key. docs/secrets.md, *Testing before storing*.
   */
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

  /**
   * One page of the replies under one post.
   *
   * **A credit buys a page, not a thread, and the provider will not say so.**
   * Measured on 2026-09-06: threads claiming 640, 296 and 95 comments each
   * returned exactly 25 for one credit, each with `more.has_more: true`. Worse,
   * draining the 95-comment thread from the top level stopped after three calls
   * with 43 comments and `has_more: false` — while fourteen nested subtrees
   * inside the first page still said `has_more: true`.
   *
   * So a top-level "no more" is not the end of the thread, and `partial` is
   * reported from that measurement rather than from the flag. This connector
   * only ever claims a thread is complete when the provider both ran out of
   * cursors and returned every reply the post said it had.
   */
  async fetchReplies(request: ReplyRequest): Promise<ReplyResult> {
    const client = this.client(request.credentials);
    const page = await client.fetchComments(request.postUrl, request.cursor, request.signal);

    const channel = textOf(page.post.subreddit);
    const { replies: parsed, itemsReturned } = toCandidateReplies(
      page.comments,
      request.postExternalId,
      channel,
      request.positionOffset ?? 0,
    );

    /**
     * The date cut, applied here because the provider offers none.
     *
     * A thread outlives the post above it, so a comment can be years older
     * than the poll that found its post. There is no ordering guarantee to
     * lean on either: this endpoint returns a ranked tree, not a newest-first
     * list, so every row is tested and paging is never stopped early on a
     * date. US-020 measured what the ordering claims are worth here — a
     * top-level `has_more: false` arrived with 33 of 58 comments missing.
     */
    const replies = request.since
      ? parsed.filter((reply) => reply.postedAt > (request.since as Date))
      : parsed;

    // The post's own count against what we hold. Equal or greater is the only
    // evidence that a thread was read to the end; anything else is partial,
    // including a page that simply stopped offering cursors.
    const claimed = page.post.num_comments;
    const complete =
      page.after === undefined &&
      typeof claimed === "number" &&
      Number.isFinite(claimed) &&
      // Against what arrived, not what survived the date cut: a thread read to
      // the end is complete however few of its comments are recent.
      parsed.length >= claimed;

    return {
      replies,
      itemsReturned,
      unitsConsumed: page.creditsCharged,
      next: page.after ? { status: "ready", cursor: page.after } : { status: "done" },
      partial: !complete,
    };
  }

  /**
   * One call, one page.
   *
   * There is no trigger and no snapshot: the posts arrive in the answer, so
   * every page costs one credit and returns something. The connector's whole
   * job is to say where the caller should come back to, and to stop paging
   * when paging would buy posts the monitor does not want.
   */
  async search(request: SearchRequest): Promise<SearchResult> {
    const client = this.client(request.credentials);
    const start =
      request.cursor === undefined ? this.first(request.query) : decodeCursor(request.cursor);

    if (!start) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    const input = this.inputAt(request.query, start);

    // The cursor points past the end of what this monitor names, which happens
    // when a monitor's queries were edited between two polls. Finishing is the
    // safe answer: the next poll starts again from the first input.
    if (!input) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    let page: Page;

    try {
      page = await client.fetchPage(
        input.endpoint,
        { ...input.params, ...(start.after ? { after: start.after } : {}) },
        request.signal,
      );
    } catch (error) {
      // A rate limit is the one failure the caller can act on by waiting. It
      // is handed up rather than slept through, so the scheduler can run
      // another monitor meanwhile. This branch has never been reached against
      // the real provider: no capture run has been rate-limited.
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

    // Truncating costs nothing here, and that is a fact about this provider
    // rather than a general one. The credit was spent on the request, not on
    // the posts, so a page trimmed to the caller's limit wastes no money. On a
    // provider that bills per record it would waste all of it.
    const posts = request.limit === undefined ? wanted : wanted.slice(0, request.limit);

    return {
      posts,
      unitsConsumed: page.creditsCharged,
      next: this.nextAfter(request, start, page, collected, wanted.length),
    };
  }

  /**
   * Where to go after this page.
   *
   * Three things end an input, and all three have to be checked or the poll
   * either stops early or pays for pages nobody wanted:
   *
   * * the provider reported no cursor, so there is no next page;
   * * this input has had its share of the poll's budget;
   * * every post on this page is older than `since`. The list is newest
   *   first, so the rest of it is older still, and the next page would be
   *   bought only to be thrown away.
   */
  private nextAfter(
    request: SearchRequest,
    at: Cursor,
    page: Page,
    collected: readonly CandidatePost[],
    kept: number,
  ): SearchResult["next"] {
    const pages = at.pages + 1;
    const reachedSince = request.query.since !== undefined && collected.length > 0 && kept === 0;
    const exhausted = !page.after || pages >= maxPagesPerInput || reachedSince;

    if (!exhausted && page.after) {
      return { status: "ready", cursor: encodeCursor({ ...at, pages, after: page.after }) };
    }

    const onward = this.advance(request.query, at);
    return onward ? { status: "ready", cursor: encodeCursor(onward) } : { status: "done" };
  }

  /** The first position that has anything to ask for, or nothing. */
  private first(query: SourceQuery): Cursor | undefined {
    return this.settle(query, { phase: "keyword", index: 0, pages: 0 });
  }

  /** The position after this one, skipping phases the monitor left empty. */
  private advance(query: SourceQuery, at: Cursor): Cursor | undefined {
    return this.settle(query, { phase: at.phase, index: at.index + 1, pages: 0 });
  }

  /**
   * Walk forward until the position names a real input, or run out.
   *
   * A monitor with no keywords and three subreddits, or with keywords and no
   * subreddits, both arrive here. Skipping is pure: it makes no request, so an
   * empty phase costs nothing.
   */
  private settle(query: SourceQuery, from: Cursor): Cursor | undefined {
    let { phase, index } = from;

    for (;;) {
      if (index < this.listFor(query, phase).length) return { phase, index, pages: 0 };

      const next = phases[phases.indexOf(phase) + 1];
      if (!next) return undefined;

      phase = next;
      index = 0;
    }
  }

  private listFor(query: SourceQuery, phase: Phase): readonly string[] {
    return phase === "keyword" ? query.queries : query.channels;
  }

  /** The endpoint and parameters for the input a cursor points at. */
  private inputAt(
    query: SourceQuery,
    at: Cursor,
  ): { endpoint: string; params: Record<string, string> } | undefined {
    const term = this.listFor(query, at.phase)[at.index];
    if (term === undefined) return undefined;

    if (at.phase === "keyword") {
      // No `timeframe`. The provider refuses one beside `sort=new`, and the
      // sort is what a monitor needs. `since` is applied after the fetch.
      return {
        endpoint: endpoints.search,
        params: { query: term, filter: "posts", sort: sortNewest },
      };
    }

    // The provider wants a bare name: "softwaretesting", never "r/…".
    return {
      endpoint: endpoints.subreddit,
      params: { subreddit: term.replace(/^\/?r\//, ""), sort: sortNewest },
    };
  }
}

/**
 * One ScrapeCreators record to one `CandidatePost`.
 *
 * Field names come from `fixtures/*.json`, captured from a live account. Every
 * field is checked rather than trusted: a post whose id or timestamp is
 * missing is not one we can store or deduplicate, and such a record is
 * dropped, not repaired.
 *
 * `name` is Reddit's own fullname — `t3_1w71bul` — and it is the id Bright
 * Data reports as `post_id` for the same post. Using it is what makes one post
 * collected through both providers one row in `posts` rather than two.
 *
 * Only the fields `posts` has a column for are read. The provider also returns
 * scores, flair, awards and subscriber counts; keeping the least we can is
 * what makes honouring a deletion cheap. STACK.md, *Honor deletions*.
 */
export function toCandidatePost(record: unknown): CandidatePost | undefined {
  if (typeof record !== "object" || record === null) return undefined;

  const row = record as Record<string, unknown>;

  const externalId = text(row.name) ?? text(row.id);
  const url = text(row.url) ?? permalink(row.permalink);
  const postedAt = timestampOf(row);

  if (!externalId || !url || !postedAt) return undefined;

  const title = text(row.title);
  const author = text(row.author);
  const channel = text(row.subreddit);

  const replyCount = row.num_comments;

  return {
    externalId,
    url,
    // A link post has a title and no body. Falling back to the title keeps the
    // classifier something to read; an empty string would score as noise.
    text: text(row.selftext) ?? title ?? "",
    postedAt,
    ...(author ? { author } : {}),
    ...(channel ? { channel } : {}),
    ...(title ? { title } : {}),
    ...(typeof replyCount === "number" && Number.isFinite(replyCount) && replyCount >= 0
      ? { replyCount }
      : {}),
  };
}

/**
 * One comment from the tree, and every comment nested under it.
 *
 * The tree is walked rather than read flat because a nested reply is a lead as
 * readily as a top-level one, and because `parent_id` is what tells them
 * apart: Reddit writes the post's `t3_` fullname there for a top-level comment
 * and the parent comment's `t1_` for a nested one. That distinction reaches
 * the classifier's prompt, so it is carried rather than flattened away.
 */
export function toCandidateReplies(
  comments: readonly unknown[],
  parentPostExternalId: string,
  channel: string | undefined,
  positionOffset = 0,
): { replies: CandidateReply[]; itemsReturned: number } {
  const out: CandidateReply[] = [];

  /**
   * Every node the provider sent, whether or not it became a reply.
   *
   * The position has to count the removed comments too. They occupy a place in
   * Reddit's ranking, and a position that closed the gap over them would say a
   * comment sat higher in the thread than it did — which is the one thing
   * US-048's measurement reads.
   */
  let seen = 0;

  const walk = (nodes: readonly unknown[]) => {
    for (const node of nodes) {
      if (typeof node !== "object" || node === null) continue;

      const position = positionOffset + seen;
      seen += 1;

      const row = node as Record<string, unknown>;
      const externalId = text(row.name) ?? (text(row.id) ? `t1_${text(row.id)}` : undefined);
      const url = text(row.url) ?? permalink(row.permalink);
      const postedAt = timestampOf(row);
      const body = text(row.body);

      // A removed comment carries `[deleted]` or `[removed]` as its body, the
      // same markers `verify` reads. It is skipped rather than stored: there
      // is nothing for a model to read, and paying to classify the word
      // "[deleted]" is the cheapest mistake in this file to avoid.
      const removed = body === undefined || body === "[deleted]" || body === "[removed]";

      if (externalId && url && postedAt && !removed && body) {
        const author = text(row.author);
        // `t3_` names the post, so a comment carrying it is top-level.
        const parent = text(row.parent_id);
        const parentReply = parent?.startsWith("t1_") ? parent : undefined;

        out.push({
          externalId,
          url,
          text: body,
          postedAt,
          parentPostExternalId,
          ...(author ? { author } : {}),
          ...(channel ? { channel } : {}),
          threadPosition: position,
          ...(parentReply ? { parentReplyExternalId: parentReply } : {}),
        });
      }

      const replies = row.replies;
      const items =
        typeof replies === "object" && replies !== null
          ? (replies as { items?: unknown }).items
          : undefined;
      if (Array.isArray(items)) walk(items);
    }
  };

  walk(comments);
  return { replies: out, itemsReturned: seen };
}

/**
 * The provider sends the time twice: `created_utc` in seconds, and
 * `created_at_iso`. The ISO field is read first because it carries its own
 * zone, and the epoch is the fallback for a record that is missing it.
 */
function timestampOf(row: Record<string, unknown>): Date | undefined {
  const iso = text(row.created_at_iso);
  if (iso) {
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const epoch = row.created_utc;
  if (typeof epoch === "number" && Number.isFinite(epoch)) {
    const parsed = new Date(epoch * 1000);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return undefined;
}

function permalink(value: unknown): string | undefined {
  const path = text(value);
  return path ? `https://www.reddit.com${path}` : undefined;
}

export function textOf(value: unknown): string | undefined {
  return text(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
