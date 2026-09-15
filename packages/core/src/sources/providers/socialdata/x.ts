/**
 * X, reached through SocialData.
 *
 * Correctness-critical: cursor and deduplication. The failure this file has to
 * avoid is the same post fetched and billed twice — and this provider bills
 * per tweet returned, so a re-fetched page is paid for in full.
 *
 * This file is one connector: the X platform and the SocialData provider, and
 * the price that pair bills. The platform is described in
 * `sources/platforms.ts` and the provider in `./provider.ts`.
 *
 * **X had one provider before this one, and that was the thinnest dependency
 * in the product.** US-006 asked three: Bright Data's X dataset discovers by
 * profile only, ScrapeCreators publishes no X search, and only SocialCrawl
 * could find a stranger. So every X poll depended on one account at one
 * company. US-061 is the second, and removing that single point of failure is
 * the case for it — the price is the smaller half.
 *
 * Everything below comes from `x-fixtures/`, captured live on 2026-09-07.
 *
 * 1. **The window goes to the provider.** `since_time:` inside the query takes
 *    a UNIX timestamp, and it works: a 24-hour window returned 7 tweets for
 *    $0.0014 where the unwindowed call returned 20 for $0.0040.
 *    `socialcrawl/x.ts` has no window and buys everything older than `since`
 *    to throw it away. **This is the only connector here that stops paying for
 *    what it will discard.**
 * 2. **`type=Latest` really orders newest first**, measured across a whole
 *    page — so the early-stop rule below rests on a measurement rather than on
 *    a documented claim, which is more than three LinkedIn connectors can say.
 * 3. **There is no URL field.** One is built from the handle and the id, and
 *    US-060 opened one: it lands on the post. It is also the exact format
 *    SocialCrawl returns, so the shape is not invented — but it is ours, which
 *    US-047 says is the kind to re-check whenever this parser changes.
 * 4. **The id is the bare tweet id**, the same number `socialcrawl/x.ts` reads
 *    out of its own `id`, so the two providers deduplicate against each other.
 * 5. **A reply page is the whole conversation, root included.** US-136
 *    captured one on 2026-09-15: eleven rows for a tweet claiming 150, newest
 *    first, nested — `in_reply_to_status_id_str` names a parent reply where
 *    there is one — and the root tweet itself as the last row, billed like
 *    the rest. Page two held only that root again, and still offered a
 *    cursor. See `fetchReplies` for what each of those decides.
 */
import { xPlatform } from "../../platforms.js";
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
import { SocialDataClient, SocialDataError } from "./client.js";
import { socialDataProvider } from "./provider.js";

/**
 * How many pages one query may buy in a single poll.
 *
 * A page is twenty tweets, so two is forty. It matches `socialcrawl/x.ts`,
 * and matching matters here: a person comparing the two providers on the
 * pricing page is shown a per-query ceiling, and two ceilings that differ for
 * no measured reason would read as a difference between the providers.
 *
 * The budget guard reads it as `maxUnitsPerQueryPoll` — in tweets, because
 * that is what this provider bills — and US-014's cost test multiplies it by
 * the polls in a month.
 */
const maxPagesPerQuery = 2;

/** A page held twenty tweets in every captured call. */
const tweetsPerPage = 20;

export const socialDataX: ConnectorDefinition = {
  platform: xPlatform,
  provider: socialDataProvider,
  /**
   * The tweet, because that is what the provider charges for.
   *
   * Not the request. Twenty tweets moved the balance $0.0040 and seven moved
   * it $0.0014, so a connector reporting "1 request" against a per-tweet price
   * would let a monitor spend twenty times its cap before anything refused it.
   * `socialcrawl/x.ts` counts requests and is right to: there one request is
   * one credit whatever it returns.
   */
  billableUnit: "tweet",
  /**
   * 200 micro-dollars a tweet — $0.0002, the provider's published rate, and
   * measured against its own balance twice.
   *
   * SocialCrawl costs one credit for twenty posts, which is 406 a post. Fifty
   * posts is $0.0100 here against $0.0203 there.
   */
  pricePerUnitMicros: 200,
  /** The unit is the tweet, so one unit is one post. */
  postsPerUnit: 1,
  /** `maxPagesPerQuery` pages of twenty: what one query costs in one poll. */
  maxUnitsPerQueryPoll: maxPagesPerQuery * tweetsPerPage,
  /** Keywords only. Nothing here searches inside a channel. */
  discovery: ["keyword"],
  /**
   * Replies, at the tweet price: $0.0002 a row, the same unit and the same
   * rate as a search, so no separate reply price is declared. Measured in
   * US-136 — eleven rows moved the balance $0.0022 — and the published rate
   * says the same. The row count is the bill, root tweet included.
   */
  canFetchReplies: true,
  create: (runtime) => new SocialDataXSource(runtime),
};

/**
 * Where the caller is: which query, how many pages of it this poll has bought,
 * and the provider's own cursor.
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

/**
 * The provider's cursor is a long opaque string. Rejoining the tail rather
 * than reading one field means a cursor that starts containing the separator
 * cannot silently truncate our place in the collection.
 */
function decodeCursor(cursor: string): Cursor {
  const parts = cursor.split(cursorSeparator);
  const index = Number(parts[0]);
  const pages = Number(parts[1]);
  const after = parts.slice(2).join(cursorSeparator);

  // A cursor the caller invented, not one we issued. Reading it as an empty
  // page would report the query finished and lose everything after it.
  if (
    parts.length < 3 ||
    !Number.isInteger(index) ||
    index < 0 ||
    !Number.isInteger(pages) ||
    pages < 0
  ) {
    throw new Error(`${xPlatform.id}: cursor "${cursor}" was not issued by this source.`);
  }

  return { index, pages, ...(after ? { after } : {}) };
}

export class SocialDataXSource implements SocialSource {
  readonly platform = socialDataX.platform;
  readonly provider = socialDataX.provider;
  readonly billableUnit = socialDataX.billableUnit;
  readonly pricePerUnitMicros = socialDataX.pricePerUnitMicros;
  readonly maxUnitsPerQueryPoll = socialDataX.maxUnitsPerQueryPoll;
  // The declaration has to reach the instance, not only the definition: every
  // screen and every step asks the connector the registry built, not the
  // record it was built from. US-034 found that wrong on another connector.
  readonly canFetchReplies = socialDataX.canFetchReplies;

  constructor(private readonly runtime: SourceRuntime) {}

  private client(credentials: SourceCredentials): SocialDataClient {
    const apiKey = credentials.apiKey;
    if (!apiKey) {
      throw new SocialDataError("credentials", "No SocialData API key was given.", 0);
    }
    return new SocialDataClient({ runtime: this.runtime, apiKey });
  }

  /**
   * Check a key without spending anything.
   *
   * The probe reads the account balance, which is free and needs no search, so
   * a person can save their settings without being billed for finding out they
   * typed the key correctly.
   *
   * It also answers a question no search could: **an empty account has a
   * perfectly good key.** A probe that searched would get a 402 and a person
   * would be told to replace a key that is fine.
   *
   * A refusal and an unreachable provider are different answers, and this
   * returns the first while throwing the second. docs/secrets.md, *Testing
   * before storing*.
   */
  async validateCredentials(credentials: SourceCredentials): Promise<CredentialCheck> {
    if (!credentials.apiKey) {
      return { valid: false, reason: "Enter your SocialData API key." };
    }

    try {
      await this.client(credentials).probe();
    } catch (error) {
      if (
        error instanceof SocialDataError &&
        (error.kind === "credentials" || error.kind === "balance")
      ) {
        return { valid: false, reason: error.message };
      }
      throw error;
    }

    return { valid: true };
  }

  /**
   * One call, one page of twenty.
   *
   * There is no trigger and no snapshot: the tweets arrive in the answer, so
   * every page costs what it returned at the moment it was asked for.
   */
  async search(request: SearchRequest): Promise<SearchResult> {
    const client = this.client(request.credentials);
    const start =
      request.cursor === undefined ? this.first(request.query) : decodeCursor(request.cursor);

    // Said once per poll rather than silently. This endpoint searches all of X
    // and has no channel mode, so a monitor that named one would otherwise be
    // quietly given a search across everything with no sign its channel was
    // dropped.
    if (request.cursor === undefined && request.query.channels.length > 0) {
      this.runtime.logger.debug(
        { platform: xPlatform.id, channels: request.query.channels.length },
        "X channels are not searched: this endpoint takes a query and nothing else.",
      );
    }

    if (!start) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    const query = request.query.queries[start.index];

    // The cursor points past the end of what this monitor names, which happens
    // when a monitor's queries were edited between two polls. Finishing is the
    // safe answer: the next poll starts again from the first query.
    if (query === undefined) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    let page: Page;

    try {
      page = await client.fetchPage(
        {
          query: this.queryFor(query, request.query.since),
          type: "Latest",
          ...(start.after ? { cursor: start.after } : {}),
        },
        request.signal,
      );
    } catch (error) {
      // A rate limit is the one failure the caller can act on by waiting. It
      // is handed up rather than slept through, so the scheduler can run
      // another monitor meanwhile. This branch has never been reached against
      // the real provider: no capture run has been rate-limited.
      if (error instanceof SocialDataError && error.kind === "rateLimit") {
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
     * The exact cut, still made here.
     *
     * `since_time:` narrows to a second, so in principle nothing older should
     * arrive — but a window sent to a provider is a request and not a
     * guarantee, and BUG-002 is what happens when one is trusted. This costs
     * nothing and it is the difference between a window that quietly stops
     * working and one that does.
     */
    const wanted = collected.filter(
      (post) => !request.query.since || post.postedAt > request.query.since,
    );

    // Truncating saves nothing here: this provider charged for every tweet the
    // page returned before the caller's limit was applied. On a per-request
    // provider a trimmed page wastes nothing; on this one it wastes the
    // difference, which is why the window above matters more than the limit.
    const posts = request.limit === undefined ? wanted : wanted.slice(0, request.limit);

    return {
      posts,
      unitsConsumed: page.tweetsReturned,
      next: this.nextAfter(request, start, page, collected, wanted.length),
    };
  }

  /**
   * The query, with the monitor's window folded into it.
   *
   * `since_time:` takes whole seconds. The instant is floored rather than
   * rounded, because rounding up would ask for posts *after* `since` and drop
   * anything written in the second between.
   */
  private queryFor(query: string, since: Date | undefined): string {
    if (!since) return query;

    return `${query} since_time:${Math.floor(since.getTime() / 1000)}`;
  }

  /**
   * Where to go after this page.
   *
   * Three things end a query, and the third is the one three LinkedIn
   * connectors had to do without:
   *
   * * the provider reported no cursor;
   * * this query has had its share of the poll's budget;
   * * every post on this page is older than `since`. **The list is newest
   *   first — measured, not assumed** — so the rest is older still, and the
   *   next page would be bought only to be thrown away. On a provider that
   *   bills per tweet that page is not a wasted request, it is a wasted
   *   twenty.
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
    const exhausted = !page.after || pages >= maxPagesPerQuery || reachedSince;

    if (!exhausted && page.after) {
      return { status: "ready", cursor: encodeCursor({ ...at, pages, after: page.after }) };
    }

    const onward = this.advance(request.query, at);
    return onward ? { status: "ready", cursor: encodeCursor(onward) } : { status: "done" };
  }

  /**
   * One page of the conversation under one tweet.
   *
   * Four things the capture decided:
   *
   * * The root tweet is one of the rows. It is dropped by id, and it is still
   *   counted in `unitsConsumed` because the provider billed it.
   * * A row from another conversation — `conversation_id_str` not the post we
   *   asked about — is dropped. BUG-007's rule, with this provider's field.
   * * The page is newest first, measured, so once every reply on it is older
   *   than `since` the walk ends: the next page would be bought to be thrown
   *   away, at $0.0002 a row.
   * * A page that yields nothing new ends the walk whatever the cursor says.
   *   Page two of the captured thread was the root alone, billed, with a
   *   cursor still offered; following it buys the same row again.
   *
   * `partial` is whether a cursor remains. The provider gave eleven rows for a
   * thread claiming 150 and no way to tell which claim is right, so a cursor
   * is the only evidence of more that this connector has.
   *
   * A 402 is thrown, not caught. It ends the replies step the way it ends a
   * search, in one log line, and the thread is re-opened on the next poll
   * because its row was never marked. Catching it here would let the step go
   * on to the next thread and meet the same answer, once per thread.
   */
  async fetchReplies(request: ReplyRequest): Promise<ReplyResult> {
    const page = await this.client(request.credentials).fetchReplyPage(
      request.postExternalId,
      request.cursor,
      request.signal,
    );

    const collected = page.records
      .map((record, index) =>
        toCandidateReply(record, {
          parentPostExternalId: request.postExternalId,
          position: (request.positionOffset ?? 0) + index,
        }),
      )
      .filter((reply): reply is CandidateReply => reply !== undefined);

    const replies = collected.filter((reply) => !request.since || reply.postedAt > request.since);

    const reachedSince =
      request.since !== undefined && collected.length > 0 && replies.length === 0;
    const more = page.after !== undefined && replies.length > 0 && !reachedSince;

    return {
      replies,
      itemsReturned: page.records.length,
      unitsConsumed: page.tweetsReturned,
      next: more && page.after ? { status: "ready", cursor: page.after } : { status: "done" },
      partial: page.after !== undefined,
    };
  }

  /** The first query, or nothing if the monitor named none for this platform. */
  private first(query: SourceQuery): Cursor | undefined {
    return query.queries.length > 0 ? { index: 0, pages: 0 } : undefined;
  }

  /** The query after this one, or nothing. */
  private advance(query: SourceQuery, at: Cursor): Cursor | undefined {
    const index = at.index + 1;
    return index < query.queries.length ? { index, pages: 0 } : undefined;
  }
}

/**
 * One SocialData tweet to one `CandidatePost`.
 *
 * Field names come from `x-fixtures/*.json`, captured from a live account.
 * Every field is checked rather than trusted: a post whose id, author or
 * timestamp is missing is not one we can store, link or deduplicate, and such
 * a record is dropped, not repaired.
 *
 * Only the fields `posts` has a column for are read. The provider also returns
 * engagement counts, entities, the whole author profile, quoted tweets and
 * media; keeping the least we can is what makes honouring a deletion cheap.
 * STACK.md, *Honor deletions*.
 */
export function toCandidatePost(record: unknown): CandidatePost | undefined {
  if (typeof record !== "object" || record === null) return undefined;

  const row = record as Record<string, unknown>;

  /**
   * The bare tweet id, which is what `socialcrawl/x.ts` reads out of its own
   * `id` — so `posts`, keyed by `(source, external_id)` with the provider
   * outside the key, will not store a post twice because a deployment changed
   * provider.
   */
  const externalId = text(row.id_str);
  const postedAt = timestampOf(row.tweet_created_at);

  const author =
    typeof row.user === "object" && row.user !== null
      ? (row.user as Record<string, unknown>)
      : undefined;

  const handle = author ? text(author.screen_name) : undefined;

  if (!externalId || !postedAt || !handle) return undefined;

  return {
    externalId,
    /**
     * Built, because this provider returns no URL at all.
     *
     * US-060 opened one and it landed on the post. It is also the exact string
     * `socialcrawl/x.ts` receives from its provider, so the two connectors
     * store the same address for the same tweet — which is worth more than it
     * looks: a match found through one provider and re-found through the other
     * is one row, with one link, that a person has already read.
     *
     * A record without a handle is dropped above rather than linked to
     * `x.com/undefined/status/…`, which would be a URL that opens nothing.
     */
    url: `https://x.com/${handle}/status/${externalId}`,
    /**
     * `full_text` rather than `text`: the shorter one is truncated on a long
     * tweet, and the classifier reads what the person wrote. There is no title
     * on this platform, so `CandidatePost.title` is left empty.
     */
    text: text(row.full_text) ?? text(row.text) ?? "",
    postedAt,
    author: handle,
  };
}

interface ReplyContext {
  readonly parentPostExternalId: string;
  readonly position: number;
}

/**
 * One row of a reply page to one `CandidateReply`, or nothing.
 *
 * Nothing for the root tweet, which the provider puts on the page; nothing
 * for a row from another conversation; nothing for a row missing what a post
 * needs. The parent reply is `in_reply_to_status_id_str` when it names
 * something other than the post itself — the captured page had six of
 * ten hanging under other replies.
 */
export function toCandidateReply(
  record: unknown,
  context: ReplyContext,
): CandidateReply | undefined {
  const post = toCandidatePost(record);
  if (!post) return undefined;
  if (post.externalId === context.parentPostExternalId) return undefined;

  const row = record as Record<string, unknown>;
  const conversation = text(row.conversation_id_str);
  if (conversation && conversation !== context.parentPostExternalId) return undefined;

  const replyTo = text(row.in_reply_to_status_id_str);
  const replyCount = typeof row.reply_count === "number" ? row.reply_count : undefined;

  return {
    ...post,
    parentPostExternalId: context.parentPostExternalId,
    ...(replyTo && replyTo !== context.parentPostExternalId
      ? { parentReplyExternalId: replyTo }
      : {}),
    threadPosition: context.position,
    ...(replyCount === undefined ? {} : { replyCount }),
  };
}

/**
 * The publish instant.
 *
 * `tweet_created_at` arrives as `2026-09-07T07:50:44.000000Z` — ISO with six
 * decimal places, which `Date` parses. It is checked rather than trusted: a
 * tweet with no readable timestamp cannot be ordered, cut against `since`, or
 * aged on the inbox, and is dropped by the caller.
 */
function timestampOf(value: unknown): Date | undefined {
  const iso = text(value);
  if (!iso) return undefined;

  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
