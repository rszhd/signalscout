/**
 * X, reached through SocialCrawl.
 *
 * Correctness-critical: cursor and deduplication. The failure this file has to
 * avoid is the same post fetched and billed twice. SocialCrawl bills one
 * credit per request, so a connector that loses its place pays again for a
 * page it already has. The cursor below is what stops that, and `x.test.ts`
 * pins it.
 *
 * This file is one connector: the X platform and the SocialCrawl provider, and
 * the price that pair bills. The platform is described in
 * `sources/platforms.ts` and the provider in `./provider.ts`, so this file
 * edits neither of them and neither knows it exists.
 *
 * It is the first connector for X, and X is the second platform. Nothing
 * downstream learns which provider answered.
 */
import { xPlatform } from "../../platforms.js";
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
import { SocialCrawlClient, SocialCrawlError, sortNewest } from "./client.js";
import { socialCrawlProvider } from "./provider.js";

/**
 * How many pages one query or one handle may cost in a single poll.
 *
 * Every page is a credit and carries up to twenty posts. The capture run's
 * first page held twenty and its second held seventeen and then ended, so two
 * pages covered a two-day window on a live query — enough for one poll of one
 * input, and a cheap mistake if it is the wrong number.
 *
 * The budget guard reads it as `maxUnitsPerQueryPoll`, and US-014's cost test
 * multiplies it by the polls in a month. It is the ceiling of that arithmetic,
 * so raising it raises every projected bill.
 */
const maxPagesPerInput = 2;

export const socialCrawlX: ConnectorDefinition = {
  platform: xPlatform,
  provider: socialCrawlProvider,
  /**
   * SocialCrawl bills one credit per request, whatever the request returns,
   * and refunds the ones that return nothing: a search matching no posts was
   * charged 0 in the capture run, twice. That is exactly why `unitsConsumed`
   * can never be a post count.
   */
  billableUnit: "request",
  /**
   * 8,118 micro-dollars per credit: the £15 Starter pack of 2,500 credits,
   * read from socialcrawl.dev/pricing on 2026-09-05, converted at
   * GBP 1 = USD 1.353, the European Central Bank reference rate for
   * 2026-09-04 as published by frankfurter.dev.
   *
   * Two things about that number, because both will be wrong one day.
   *
   * The pack is the smallest one, which is the dearest per credit and the one
   * a new self-hoster buys. The larger packs are £49 for 20,000 and £299 for
   * 150,000, which are 3,315 and 2,697 micro-dollars at the same rate. A
   * person on a larger pack is told they spent more than they did and stops
   * early; a person told the reverse spends past their cap, so the smallest
   * pack is the safe direction for a guard whose job is to refuse.
   *
   * And the provider prices in pounds while every figure in this product is in
   * micro-dollars, so this one number carries an exchange rate that nobody
   * re-reads. docs/costs.md already says the spend is an estimate. This is one
   * more reason it is.
   */
  pricePerUnitMicros: 8118,
  /** `maxPagesPerInput`: what one query or handle costs in one poll. */
  maxUnitsPerQueryPoll: maxPagesPerInput,
  create: (runtime) => new SocialCrawlXSource(runtime),
};

/**
 * Queries and handles are two discovery modes, and one request carries one
 * input from one of them. A monitor may name both, so the connector walks them
 * in turn.
 *
 * On Reddit the two modes are two endpoints. Here they are one endpoint and
 * two query strings, because X's search operators do the work: `from:handle`
 * is a search like any other. The caller sees no difference either way.
 */
const phases = ["keyword", "handle"] as const;
type Phase = (typeof phases)[number];

/**
 * Where the caller is: which phase, which input inside it, how many pages of
 * that input this poll has already bought, and the provider's own cursor.
 *
 * All four are load-bearing. The phase lets a monitor that named both queries
 * and handles reach its handles at all. The index stops the second poll
 * re-reading the first query for ever. The page count is what
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
 * The provider's cursor is a long base64 blob. It contains no separator today,
 * but rejoining the tail rather than reading one field means a provider that
 * starts using one cannot silently truncate our place in the collection.
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
    throw new Error(`${xPlatform.id}: cursor "${cursor}" was not issued by this source.`);
  }

  return { phase: phase as Phase, index, pages, ...(after ? { after } : {}) };
}

export class SocialCrawlXSource implements SocialSource {
  readonly platform = socialCrawlX.platform;
  readonly provider = socialCrawlX.provider;
  readonly billableUnit = socialCrawlX.billableUnit;
  readonly pricePerUnitMicros = socialCrawlX.pricePerUnitMicros;
  readonly maxUnitsPerQueryPoll = socialCrawlX.maxUnitsPerQueryPoll;

  constructor(private readonly runtime: SourceRuntime) {}

  private client(credentials: SourceCredentials): SocialCrawlClient {
    const apiKey = credentials.apiKey;
    if (!apiKey) {
      throw new SocialCrawlError("credentials", "No SocialCrawl API key was given.", 0);
    }
    return new SocialCrawlClient({ runtime: this.runtime, apiKey });
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
   * One call, one page.
   *
   * There is no trigger and no snapshot: the posts arrive in the answer, so
   * every page costs one credit and an empty one costs nothing. The
   * connector's whole job is to say where the caller should come back to, and
   * to stop paging when paging would buy posts the monitor does not want.
   */
  async search(request: SearchRequest): Promise<SearchResult> {
    const client = this.client(request.credentials);
    const start =
      request.cursor === undefined ? this.first(request.query) : decodeCursor(request.cursor);

    if (!start) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    const query = this.queryAt(request.query, start);

    // The cursor points past the end of what this monitor names, which happens
    // when a monitor's queries were edited between two polls. Finishing is the
    // safe answer: the next poll starts again from the first input.
    if (query === undefined) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    let page: Page;

    try {
      page = await client.fetchPage(
        {
          query,
          sort: sortNewest,
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

    // The `since:` operator in the query narrows to a whole day, so the last
    // day before `since` arrives whether we asked for it or not. This is the
    // exact cut.
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
      unitsConsumed: page.creditsUsed,
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
   * * every post on this page is older than `since`. The list is newest first,
   *   so the rest of it is older still, and the next page would be bought only
   *   to be thrown away.
   *
   * An empty page ends the input through the first of those, and that is the
   * right answer even though an empty page is sometimes the provider having a
   * bad minute: the next poll asks the same query again, and an empty answer
   * costs nothing.
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
    const exhausted = !page.cursor || pages >= maxPagesPerInput || reachedSince;

    if (!exhausted && page.cursor) {
      return { status: "ready", cursor: encodeCursor({ ...at, pages, after: page.cursor }) };
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
   * A monitor with no queries and three handles, or with queries and no
   * handles, both arrive here. Skipping is pure: it makes no request, so an
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

  /**
   * The search string for the input a cursor points at.
   *
   * Everything this provider takes beyond the words themselves is an X search
   * operator inside the same string: the endpoint has no date parameter and no
   * author parameter. So a handle becomes `from:handle`, and `since` becomes
   * `since:YYYY-MM-DD`.
   *
   * The words a monitor supplied are passed through unchanged and unquoted.
   * Quoting was measured and it is not an improvement: the exact phrase `end
   * to end tests keep breaking` matched nothing on two separate runs, while
   * the same words unquoted matched posts. What the same run also showed is
   * that a long unquoted phrase matches loosely — that is a fact about the
   * queries we generate, not about this connector, and US-006's Log says so.
   */
  private queryAt(query: SourceQuery, at: Cursor): string | undefined {
    const term = this.listFor(query, at.phase)[at.index];
    if (term === undefined) return undefined;

    // A person may type either "@intentwatch" or "intentwatch"; the operator
    // takes neither an at-sign nor a URL.
    const words =
      at.phase === "keyword" ? term : `from:${term.replace(/^@/, "").replace(/^.*x\.com\//, "")}`;

    return [words, this.sinceOperator(query.since)].filter(Boolean).join(" ");
  }

  /**
   * `since:` takes a date and not a time, so it is floored to the day.
   *
   * Flooring is the safe direction: asking from the start of the day returns
   * posts we already hold, which `posts` deduplicates and which cost nothing
   * extra because the page was already bought. Rounding the other way would
   * skip the hours between midnight and the last poll.
   */
  private sinceOperator(since: Date | undefined): string {
    if (!since) return "";

    const day = since.toISOString().slice(0, 10);
    return `since:${day}`;
  }
}

/**
 * One SocialCrawl item to one `CandidatePost`.
 *
 * Field names come from `fixtures/*.json`, captured from a live account. Every
 * field is checked rather than trusted: a post whose id or timestamp is
 * missing is not one we can store or deduplicate, and such a record is
 * dropped, not repaired.
 *
 * Only the fields `posts` has a column for are read. The provider also returns
 * engagement counts, a language guess, an estimated reach and a content
 * category; keeping the least we can is what makes honouring a deletion cheap.
 * STACK.md, *Honor deletions*.
 *
 * There is no `channel`: on X the author is the context, which is what
 * `CandidatePost` already says. A handle a monitor watches is how the post was
 * found, not a place the post lives.
 */
export function toCandidatePost(record: unknown): CandidatePost | undefined {
  if (typeof record !== "object" || record === null) return undefined;

  const post = (record as Record<string, unknown>).post;
  if (typeof post !== "object" || post === null) return undefined;

  const row = post as Record<string, unknown>;

  const externalId = text(row.id);
  const url = text(row.url);
  const postedAt = timestampOf(row.published_at);

  if (!externalId || !url || !postedAt) return undefined;

  // The provider marks a post it already knows is gone. This is not the
  // deletion check — US-015 owns that, and it re-checks posts we stored — but
  // storing a post the provider has already flagged would be showing removed
  // content from the first minute.
  if (flag(row.flags, "deleted") === true) return undefined;

  const content =
    typeof row.content === "object" && row.content !== null
      ? (row.content as Record<string, unknown>)
      : {};

  const author =
    typeof row.author === "object" && row.author !== null
      ? text((row.author as Record<string, unknown>).username)
      : undefined;

  return {
    externalId,
    url,
    // A post with no text is a post with only media. The classifier is given
    // an empty string rather than nothing, and scores it as noise, which is
    // what a picture with no words is to a monitor reading for intent.
    text: text(content.text) ?? "",
    postedAt,
    ...(author ? { author } : {}),
  };
}

function timestampOf(value: unknown): Date | undefined {
  const iso = text(value);
  if (!iso) return undefined;

  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function flag(flags: unknown, name: string): boolean | undefined {
  if (typeof flags !== "object" || flags === null) return undefined;

  const value = (flags as Record<string, unknown>)[name];
  return typeof value === "boolean" ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
