/**
 * The connector interface every social source implements.
 *
 * PLAN.md sketches three members: `id`, `validateCredentials` and `search`.
 * Three facts about how Reddit and X actually bill and throttle are missing
 * from that sketch, and each one, left out, ends up copied into the worker:
 *
 * 1. **A page carries a cost as well as a cursor.** Reddit bills one call and
 *    returns up to 100 posts. X bills every post read. The caller cannot work
 *    the charge out from the post count, so `search` reports it.
 * 2. **Back-off belongs to the connector.** Reddit sends `X-Ratelimit-*`
 *    headers and X does not. The caller learns only *when* to come back, never
 *    how the connector found out.
 * 3. **A source declares its own price.** The budget guard needs a number.
 *    Hard-coding X's $0.005 in the worker puts a pricing fact in the wrong
 *    file.
 */
import type { Logger } from "../logger.js";

/** A connector's stable name. Lower-case, digits and hyphens: it reaches URLs and columns. */
export type SourceId = string;

export const sourceIdPattern = /^[a-z][a-z0-9-]*$/;

/**
 * One credential the user supplies. A connector declares its own list, so the
 * settings form is generic and a new connector adds no UI case.
 */
export interface CredentialField {
  readonly name: string;
  /** Shown next to the input. */
  readonly label: string;
  /** True for anything that must never be echoed back. US-004 encrypts these. */
  readonly secret: boolean;
}

/** Whatever the user pasted, keyed by `CredentialField.name`. */
export type SourceCredentials = Readonly<Record<string, string>>;

/**
 * The answer to "does this key work?".
 *
 * PLAN.md's sketch returns a boolean. A boolean cannot tell a user whether the
 * key is wrong, expired or missing a scope, and this is a bring-your-own-keys
 * product where that sentence is the whole support channel.
 */
export type CredentialCheck =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };

/**
 * What a source needs to run one search.
 *
 * PLAN.md's sketch passes the monitor row. A row would make every connector
 * read the Drizzle schema, and connectors have no business there. This carries
 * the generated queries and nothing else.
 */
export interface SourceQuery {
  /** Search strings, generated in US-010. A connector never writes one. */
  readonly queries: readonly string[];
  /** Subreddits on Reddit. Empty for a source with no channel idea. */
  readonly channels: readonly string[];
  /** Return nothing posted at or before this time. The cursor is the finer tool. */
  readonly since?: Date;
}

export interface SearchRequest {
  readonly query: SourceQuery;
  readonly credentials: SourceCredentials;
  /**
   * Opaque. It came from a previous `SearchResult` and means nothing to the
   * caller. Absent starts the query from the beginning.
   */
  readonly cursor?: string;
  /**
   * The most posts the caller wants back. A source may return fewer and still
   * have more: read `next`, never the length of `posts`.
   */
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

/**
 * A post as the source gave it. Not a row: `posts` stores an excerpt, and
 * choosing that excerpt is the collector's decision, not the connector's.
 */
export interface CandidatePost {
  /** The id the source gave it, such as a Reddit `t3_` fullname. */
  readonly externalId: string;
  readonly url: string;
  readonly author?: string;
  /** The subreddit on Reddit. Absent on X, where the author is the context. */
  readonly channel?: string;
  readonly title?: string;
  /** The post body as fetched. */
  readonly text: string;
  /** When the author posted it, not when we read it. */
  readonly postedAt: Date;
}

/**
 * Where the caller stands after a page, and the only thing it needs in order
 * to schedule the next call.
 *
 * The three states are exhaustive on purpose. A cursor exists exactly when
 * there is another page, so a caller cannot page past the end, and a caller
 * cannot read a cursor without also reading whether it must wait first.
 */
export type NextPage =
  /** The query is finished. Nothing more to fetch, nothing more to bill. */
  | { readonly status: "done" }
  /** Another page is ready now. */
  | { readonly status: "ready"; readonly cursor: string }
  /**
   * Another page exists, and the source will not serve it until `retryAfter`.
   * The connector already backed off as far as it was willing to; this is the
   * remainder, handed up so the scheduler can do something else meanwhile.
   * An absent cursor means "start this query again from the beginning".
   */
  | { readonly status: "wait"; readonly retryAfter: Date; readonly cursor?: string };

export interface SearchResult {
  readonly posts: readonly CandidatePost[];
  /**
   * Billable units this call consumed, in the source's own unit. Zero is a
   * legal answer: Reddit's free tier costs nothing.
   *
   * This is not the post count. Reddit bills one call for up to 100 posts, and
   * X bills each post read. That is the whole reason the field exists.
   */
  readonly unitsConsumed: number;
  readonly next: NextPage;
}

/**
 * The static facts about a source: everything the budget guard, the settings
 * form and the registry need before anything is instantiated.
 */
export interface SourceDescriptor {
  readonly id: SourceId;
  /** Shown to a person. "Reddit", not "reddit". */
  readonly displayName: string;
  /**
   * What one billable unit is, singular and lower-case: "call", "post read".
   * Without it the price below is ambiguous, because Reddit and X do not bill
   * the same thing.
   */
  readonly billableUnit: string;
  /**
   * The price of one billable unit in micro-dollars — millionths of one US
   * dollar, an integer so no cost is ever a rounding artefact.
   *
   *   X, one post read           $0.005      → 5000
   *   Reddit commercial, one call $0.00024   → 240
   *   Reddit free tier            $0         → 0
   *
   * STACK.md, *Source economics*, holds the table this came from.
   */
  readonly pricePerUnitMicros: number;
  /**
   * The most billable units one query can consume in one poll, when the caller
   * asks for no limit of its own.
   *
   * US-014 needs it, and it is here rather than in the estimate for the reason
   * the price is: the number belongs to the connector. A cost test that
   * hard-coded Reddit's fifty records would report the wrong figure for every
   * other source, and would go stale silently the day the connector's own
   * default moved.
   *
   * It is the top of the range a cost test reports for a query whose sample
   * came back full. A sample of ten that was billed ten says only "there was
   * more", and this is how much more there could be.
   */
  readonly maxUnitsPerQueryPoll: number;
  readonly credentialFields: readonly CredentialField[];
}

export interface SocialSource extends SourceDescriptor {
  validateCredentials(credentials: SourceCredentials): Promise<CredentialCheck>;
  search(request: SearchRequest): Promise<SearchResult>;
}

/**
 * What a connector is given at construction. Every side effect a connector has
 * arrives through here, so a test can make the network unreachable and make a
 * back-off take no real time.
 */
export interface SourceRuntime {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => Date;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly logger: Logger;
}

/**
 * A connector as the registry holds it: the static facts, plus the one
 * function that turns them into a working source. Adding a connector means
 * exporting one of these.
 */
export interface SourceDefinition extends SourceDescriptor {
  create(runtime: SourceRuntime): SocialSource;
}
