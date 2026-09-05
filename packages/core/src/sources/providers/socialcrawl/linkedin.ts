/**
 * LinkedIn, reached through SocialCrawl.
 *
 * Correctness-critical: cursor and deduplication. The failure this file has to
 * avoid is the same post fetched and billed twice, and it is the most
 * expensive place in this product to make that mistake — one call here costs
 * five credits, where an X call costs one.
 *
 * This file is one connector: the LinkedIn platform and the SocialCrawl
 * provider, and the price that pair bills. The platform is described in
 * `sources/platforms.ts` and the provider in `./provider.ts`, so this file
 * edits neither of them and neither knows it exists.
 *
 * It is not the X connector with a different URL, and three measured
 * differences are why:
 *
 * 1. **The answer is ordered by relevance, not by date.** A captured page ran
 *    22 August, 22 August, 4 September, 31 August, 15 August. So the trick
 *    `x.ts` uses — stop paging when a page falls entirely before `since`,
 *    because the list is newest first — is wrong here. It would throw away a
 *    fresh post sitting behind an old one.
 * 2. **The window is a parameter, not an operator.** X takes `since:` inside
 *    the query string. This endpoint takes `date_posted`, which accepts three
 *    fixed windows and nothing finer, so `since` is served by the narrowest
 *    window that still covers it and then cut exactly, here.
 * 3. **A search never comes back empty.** A phrase that cannot occur returned
 *    ten unrelated posts and cost the full five credits. An empty page is a
 *    signal on X; here there is no such signal to read.
 */
import { linkedInPlatform } from "../../platforms.js";
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
import { linkedInPostSearchProfile, SocialCrawlClient, SocialCrawlError } from "./client.js";
import { socialCrawlProvider } from "./provider.js";

/**
 * How many pages one query may cost in a single poll.
 *
 * A page is ten posts and five credits, so two pages is twenty posts for about
 * $0.081 — the dearest query in this product by a wide margin. It matches the
 * X connector's number, and the reason to match rather than to raise is that
 * relevance ordering makes a third page worth less than the second: the
 * provider has already put its best answers first.
 *
 * The budget guard reads it as `maxUnitsPerQueryPoll`, in credits, and US-014's
 * cost test multiplies it by the polls in a month. Raising it raises every
 * projected bill.
 */
const maxPagesPerQuery = 2;

/** What one call costs, when the provider does not say. Measured at five. */
const creditsPerCall = 5;

export const socialCrawlLinkedIn: ConnectorDefinition = {
  platform: linkedInPlatform,
  provider: socialCrawlProvider,
  /**
   * The credit, and not the request.
   *
   * `x.ts` calls its unit a request, and it is right to, because one X request
   * is one credit. Here one request is five. A connector reporting "1 request"
   * against a per-credit price would tell the budget guard that a poll cost a
   * fifth of the bill, and the guard would let a monitor spend five times its
   * cap before it noticed. The provider reports credits, so credits is what
   * this connector counts.
   */
  billableUnit: "credit",
  /**
   * 8,118 micro-dollars per credit — the same number `x.ts` carries, because
   * it is one account, one credit pack and one price. The £15 Starter pack of
   * 2,500 credits, read from socialcrawl.dev/pricing on 2026-09-05, converted
   * at GBP 1 = USD 1.353, the European Central Bank reference rate for
   * 2026-09-04 as published by frankfurter.dev.
   *
   * What differs from X is not the price of a credit but how many a call
   * takes. Five credits a call, ten posts a call: about $0.0041 a post, which
   * is ten times an X post and twenty-seven times a Bright Data Reddit record.
   * That number belongs in front of anyone choosing this platform, and
   * docs/costs.md is where it is said.
   */
  pricePerUnitMicros: 8118,
  /** Two pages, five credits each. */
  maxUnitsPerQueryPoll: maxPagesPerQuery * creditsPerCall,
  create: (runtime) => new SocialCrawlLinkedInSource(runtime),
};

/**
 * The three windows `date_posted` accepts, narrowest first.
 *
 * The provider listed them itself when the capture sent an invalid value:
 * "Allowed values: past_24h, past_week, past_month." There is nothing finer,
 * and there is no way to ask for an arbitrary date.
 */
const windows = [
  { value: "past_24h", covers: 24 * 60 * 60 * 1000 },
  { value: "past_week", covers: 7 * 24 * 60 * 60 * 1000 },
  { value: "past_month", covers: 31 * 24 * 60 * 60 * 1000 },
] as const;

/**
 * Where the caller is: which query, how many pages of it this poll has bought,
 * and the provider's own cursor.
 *
 * There is one phase and not two, because this connector has no channel mode.
 * The endpoint documents `from_member` and `from_company` and does not say
 * whether they take a URL, a slug or an urn; a wrong guess costs five credits
 * and teaches nothing, so US-028 left them unasked and unimplemented rather
 * than shipping a guess. A monitor's channels are ignored here, and
 * `search` says so in its log line.
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
 * The provider's cursor is a base64 blob prefixed `sc.`. It contains no
 * separator today, but rejoining the tail rather than reading one field means a
 * provider that starts using one cannot silently truncate our place.
 */
function decodeCursor(cursor: string): Cursor {
  const parts = cursor.split(cursorSeparator);
  const [rawIndex, rawPages] = parts;
  const index = Number(rawIndex);
  const pages = Number(rawPages);
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
    throw new Error(`${linkedInPlatform.id}: cursor "${cursor}" was not issued by this source.`);
  }

  return { index, pages, ...(after ? { after } : {}) };
}

export class SocialCrawlLinkedInSource implements SocialSource {
  readonly platform = socialCrawlLinkedIn.platform;
  readonly provider = socialCrawlLinkedIn.provider;
  readonly billableUnit = socialCrawlLinkedIn.billableUnit;
  readonly pricePerUnitMicros = socialCrawlLinkedIn.pricePerUnitMicros;
  readonly maxUnitsPerQueryPoll = socialCrawlLinkedIn.maxUnitsPerQueryPoll;

  constructor(private readonly runtime: SourceRuntime) {}

  private client(credentials: SourceCredentials): SocialCrawlClient {
    const apiKey = credentials.apiKey;
    if (!apiKey) {
      throw new SocialCrawlError("credentials", "No SocialCrawl API key was given.", 0);
    }
    return new SocialCrawlClient({
      runtime: this.runtime,
      apiKey,
      profile: linkedInPostSearchProfile,
    });
  }

  /**
   * Check a key without spending anything.
   *
   * The probe sends a search with no query, which this endpoint refuses on the
   * parameter — "Missing required parameter(s): query" — after it has accepted
   * the key. Both answers were captured and both reported `credits_used: 0`
   * against an unchanged balance, which matters more here than on X: a probe
   * billed at five credits would charge a person for typing their key
   * correctly.
   *
   * A refusal and an unreachable provider are different answers, and this
   * returns the first while throwing the second: they lead to different
   * actions, and a person whose provider is down must not be told to replace a
   * working key. docs/secrets.md, *Testing before storing*.
   */
  async validateCredentials(credentials: SourceCredentials): Promise<CredentialCheck> {
    if (!credentials.apiKey) {
      return { valid: false, reason: "Enter your SocialCrawl API key." };
    }

    try {
      await this.client(credentials).probe();
    } catch (error) {
      if (error instanceof SocialCrawlError && error.kind === "credentials") {
        return { valid: false, reason: error.message };
      }
      throw error;
    }

    return { valid: true };
  }

  /**
   * One call, one page of ten.
   *
   * There is no trigger and no snapshot: the posts arrive in the answer, so
   * every page costs its credits at the moment it is asked for. The
   * connector's whole job is to say where the caller should come back to, and
   * to stop paging when paging would buy posts the monitor does not want.
   */
  async search(request: SearchRequest): Promise<SearchResult> {
    const client = this.client(request.credentials);
    const start =
      request.cursor === undefined ? this.first(request.query) : decodeCursor(request.cursor);

    if (request.cursor === undefined && request.query.channels.length > 0) {
      this.runtime.logger.debug(
        { platform: linkedInPlatform.id, channels: request.query.channels.length },
        "LinkedIn channels are not searched: this connector has no proven channel mode.",
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
          query,
          ...this.window(request.query.since),
          ...(start.after ? { cursor: start.after } : {}),
        },
        request.signal,
      );
    } catch (error) {
      // A rate limit is the one failure the caller can act on by waiting. It
      // is handed up rather than slept through, so the scheduler can run
      // another monitor meanwhile. This branch has never been reached against
      // the real provider: no capture run has been rate-limited.
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

    // `date_posted` narrows to a whole window, and the narrowest is a day, so
    // posts older than `since` arrive whether we asked for them or not. This
    // is the exact cut, and it is done here rather than trusted to the
    // provider.
    const wanted = collected.filter(
      (post) => !request.query.since || post.postedAt > request.query.since,
    );

    // Truncating costs nothing: the credits were spent on the request, not on
    // the posts. On a provider that bills per record it would waste all of it.
    const posts = request.limit === undefined ? wanted : wanted.slice(0, request.limit);

    return {
      posts,
      unitsConsumed: page.creditsUsed,
      next: this.nextAfter(request, start, page),
    };
  }

  /**
   * Where to go after this page.
   *
   * Two things end a query, and there is deliberately no third:
   *
   * * the provider reported no cursor, or said `has_more: false`;
   * * this query has had its share of the poll's budget.
   *
   * `x.ts` has a third — every post on the page is older than `since`, so the
   * rest is older still. That rule depends on a newest-first list, and this
   * endpoint sorts by relevance. A captured page ran 22 August, 4 September,
   * 15 August in that order, so an old page here says nothing at all about the
   * next one.
   */
  private nextAfter(request: SearchRequest, at: Cursor, page: Page): SearchResult["next"] {
    const pages = at.pages + 1;

    if (page.cursor && pages < maxPagesPerQuery) {
      return { status: "ready", cursor: encodeCursor({ ...at, pages, after: page.cursor }) };
    }

    const onward = this.advance(request.query, at);
    return onward ? { status: "ready", cursor: encodeCursor(onward) } : { status: "done" };
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

  /**
   * The narrowest window that still covers everything the caller asked for.
   *
   * Narrower is cheaper in posts we throw away, and never cheaper in credits —
   * the call costs five either way. Too narrow, though, silently loses posts,
   * so the rule is to widen: a `since` of nine days back takes `past_month`
   * and the exact cut happens on our side. A `since` older than a month, or
   * none at all, sends no window and takes whatever the provider gives.
   */
  private window(since: Date | undefined): Record<string, string> {
    if (!since) return {};

    const age = this.runtime.now().getTime() - since.getTime();
    const window = windows.find((candidate) => age <= candidate.covers);

    return window ? { date_posted: window.value } : {};
  }
}

/**
 * One SocialCrawl LinkedIn item to one `CandidatePost`.
 *
 * Field names come from `linkedin-fixtures/*.json`, captured from a live
 * account. Every field is checked rather than trusted: a post whose id or
 * timestamp is missing is not one we can store or deduplicate, and such a
 * record is dropped, not repaired.
 *
 * Only the fields `posts` has a column for are read. The provider also returns
 * like, comment and share counts, a breakdown of reaction types and four sizes
 * of the author's photograph; keeping the least we can is what makes honouring
 * a deletion cheap. STACK.md, *Honor deletions*.
 */
export function toCandidatePost(record: unknown): CandidatePost | undefined {
  if (typeof record !== "object" || record === null) return undefined;

  const row = record as Record<string, unknown>;

  const externalId = text(row.id);
  const url = text(row.url);
  const postedAt = timestampOf(row.created_at);

  if (!externalId || !url || !postedAt) return undefined;

  const author =
    typeof row.author === "object" && row.author !== null
      ? (row.author as Record<string, unknown>)
      : undefined;

  const handle = author ? profileSlug(text(author.url)) : undefined;

  return {
    externalId,
    url,
    /**
     * The post text is under `title`, and there is no second text field. That
     * is the provider's name for it and not a heading: a captured item's
     * `title` held five paragraphs about flaky tests. So `text` is filled and
     * `CandidatePost.title` is left empty, because a title this platform does
     * not have would be the body repeated.
     *
     * A post with no words is a post with only an image. The classifier is
     * given an empty string rather than nothing, and scores it as noise, which
     * is what a picture with no words is to a monitor reading for intent.
     */
    text: text(row.title) ?? "",
    postedAt,
    ...(handle ? { author: handle } : {}),
  };
}

/**
 * The profile slug out of an author URL: `linkedin.com/in/<slug>`.
 *
 * The slug is stored rather than `author.name`, and the two are not
 * interchangeable. A display name is not unique, it is not stable, and it is
 * the field a person changes when they add a credential to it. A slug
 * identifies the account, which is what a column called `author` is for.
 *
 * A company page — `linkedin.com/company/<slug>` — is an author here too, and
 * it is read the same way.
 */
function profileSlug(url: string | undefined): string | undefined {
  if (!url) return undefined;

  const match = url.match(/linkedin\.com\/(?:in|company|school|showcase)\/([^/?#]+)/i);
  return match ? match[1] : undefined;
}

function timestampOf(value: unknown): Date | undefined {
  const iso = text(value);
  if (!iso) return undefined;

  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
