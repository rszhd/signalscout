/**
 * The connector interface every social source implements.
 *
 * PLAN.md sketches three members: `id`, `validateCredentials` and `search`.
 * Three facts about how Reddit and X actually bill and throttle are missing
 * from that sketch, and each one, left out, ends up copied into the worker:
 *
 * 1. **A page carries a cost as well as a cursor.** One provider bills a call
 *    that returns up to 100 posts, another bills every record, and a third
 *    refunds the call that found nothing. The caller cannot work the charge out
 *    from the post count, so `search` reports it.
 * 2. **Back-off belongs to the connector.** Every provider says "slow down" in
 *    its own dialect, and one of ours has never said it at all. The caller
 *    learns only *when* to come back, never how the connector found out.
 * 3. **A source declares its own price.** The budget guard needs a number, and
 *    the three we ship differ by a factor of five. Hard-coding one in the
 *    worker puts a pricing fact in the wrong file.
 *
 * US-024 split the word "source" into the two things it had been holding at
 * once. Until then one provider served one platform, so one record could
 * describe both. Two providers fetching Reddit cannot share a price, a
 * billable unit or a key list, so the axes are separate here:
 *
 * * A **platform** is what a person ticks. It keys `posts.source`, it keys
 *   deduplication, and a monitor names it.
 * * A **provider** is who fetches, whose key it is, and what it bills.
 * * A working **connector** is the pair, and it is what the registry holds.
 *
 * The rule underneath did not change. The interface is not weakened to suit a
 * provider, and nothing downstream of a connector learns which provider
 * answered. STACK.md, *A source is not a provider*.
 */
import type { Logger } from "../logger.js";

/**
 * A platform's stable name: "reddit", "x". Lower-case, digits and hyphens,
 * because it reaches URLs and the `posts.source` column.
 */
export type PlatformId = string;

/**
 * A provider's stable name: "brightdata", "scrapecreators". Same alphabet, and
 * it reaches `source_credentials.provider` and the environment variable that
 * holds a key.
 */
export type ProviderId = string;

/**
 * Which provider fetches each platform, as somebody recorded it.
 *
 * A platform with one usable connector is absent from here, and that is the
 * common deployment: it holds one provider's key, so there is nothing to
 * choose. An entry exists only where a person answered the question, and it is
 * read rather than guessed — answering from registration order would spend
 * money at a provider nobody picked.
 *
 * `source_providers` is where it is stored. US-026.
 */
export type ProviderChoices = Readonly<Partial<Record<PlatformId, ProviderId>>>;

/** Both ids are spelled the same way, so one pattern answers for both. */
export const connectorIdPattern = /^[a-z][a-z0-9-]*$/;

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
  /**
   * Whether the monitor wants the replies underneath the posts it finds.
   *
   * It is here rather than on `SearchRequest` because it is the monitor's
   * setting, and every stage that reads a query needs to know it — the poll
   * decides whether to open threads, and the cost test has to say what a
   * month of it costs. A connector's `search` ignores it: replies are fetched
   * by `fetchReplies`, in a second call, because every provider we have reads
   * them by post URL and a search does not know a URL until it has answered.
   *
   * A connector with no `fetchReplies` ignores this entirely rather than
   * failing. US-020.
   */
  readonly includeReplies?: boolean;
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
  /**
   * How many replies the platform says this post has.
   *
   * The poll stores it and compares it on the next pass, because that is what
   * makes "open a thread only when something was said in it" possible without
   * paying to find out. Both Reddit answers carry it on every post and X
   * carries it as `engagement.comments`.
   *
   * Absent means the platform did not say. That is not zero, and a poll must
   * treat it as "cannot tell" and fall back to its own bound.
   */
  readonly replyCount?: number;
}

/**
 * One reply, as a connector returns it.
 *
 * It is a `CandidatePost` and two links, because a reply is stored in `posts`
 * like anything else: it has its own platform id, its own author and its own
 * text, and `UNIQUE (source, external_id)` keys it exactly as a post. Reddit's
 * `t1_` fullname and an X reply id are the same kind of thing.
 *
 * The two links are what a post does not have. A reply is unreadable without
 * the post above it — "same here, what did you switch to?" names no product
 * and no problem — so the parent travels with it and reaches the classifier's
 * prompt.
 */
export interface CandidateReply extends CandidatePost {
  /** The `external_id` of the post this reply hangs under. Never absent. */
  readonly parentPostExternalId: string;
  /**
   * The `external_id` of the reply directly above this one, when there is one.
   *
   * Absent means the reply sits directly under the post. On Reddit that is
   * `parent_id` starting `t3_`; on X and LinkedIn the provider says so in the
   * shared comment schema.
   */
  readonly parentReplyExternalId?: string;
}

export interface ReplyRequest {
  /** The post to read replies under. Every provider we have takes a URL. */
  readonly postUrl: string;
  /** The platform id of that post, so a connector can check what came back. */
  readonly postExternalId: string;
  readonly credentials: SourceCredentials;
  /** Opaque, from a previous `ReplyResult`. Absent starts at the first page. */
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}

export interface ReplyResult {
  readonly replies: readonly CandidateReply[];
  /** Billable units this call consumed, in the source's own unit. */
  readonly unitsConsumed: number;
  readonly next: NextPage;
  /**
   * Whether this answer is known to be missing replies the thread holds.
   *
   * **This is not `next.status === "done"`, and conflating them is the bug
   * this field exists to prevent.** ScrapeCreators reports a top-level
   * `has_more: false` while nested subtrees underneath it still say
   * `has_more: true`: measured on 2026-09-06, a thread of 95 comments answered
   * "complete" after 43. SocialCrawl publishes the same warning about its own
   * `truncated`, which can arrive with no cursor at all.
   *
   * So a connector that cannot promise completeness says `true` here, and
   * nothing may record the thread as fully read. False means the connector
   * has positive evidence it reached the end, not merely that it ran out of
   * cursors.
   */
  readonly partial: boolean;
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
   * This is not the post count. One request bought 7 posts at one provider, 23
   * at the same provider on another query, and 20 at a third — and a request
   * that matched nothing was refunded. That is the whole reason the field
   * exists.
   */
  readonly unitsConsumed: number;
  readonly next: NextPage;
}

/**
 * A platform: what a person ticks.
 *
 * This axis keys `posts.source` and the deduplication behind it, and it is
 * what `monitors.sources` names. It holds nothing about money and nothing
 * about keys, because the same Reddit post can arrive through two providers
 * that agree about neither.
 */
export interface PlatformDescriptor {
  readonly id: PlatformId;
  /** Shown to a person. "Reddit", not "reddit". */
  readonly displayName: string;
  /**
   * How a search behaves here, for the generator that writes the queries.
   *
   * This is a platform fact and not a provider one, which is why it sits on
   * this axis. A Reddit post has a title and paragraphs, so a six-word phrase
   * can appear inside it. An X post is a few sentences, so the same phrase
   * matches nothing — US-006 measured both, and US-027 is the ticket that
   * carries the fix.
   *
   * A platform that says nothing here gets the generator's default, which is
   * the wider Reddit-shaped rule.
   */
  readonly search?: PlatformSearchStyle;
}

/**
 * What a query has to look like to work on one platform.
 *
 * `maxQueryWords` is the number that was measured. `note` is the sentence the
 * model is given, and it says *why*, because a limit with no reason is a limit
 * a model talks itself out of.
 */
export interface PlatformSearchStyle {
  readonly maxQueryWords: number;
  readonly note: string;
}

/**
 * A provider: who fetches, and whose key it is.
 *
 * `credentialFields` belongs here and not to the platform. One Bright Data key
 * serves Reddit, X and LinkedIn together, and a list kept on the platform
 * would make a person paste that one key three times and rotate it three
 * times.
 */
export interface ProviderDescriptor {
  readonly id: ProviderId;
  /** Shown to a person. "Bright Data", not "brightdata". */
  readonly displayName: string;
  readonly credentialFields: readonly CredentialField[];
}

/**
 * A connector: the pair, and what the pair bills.
 *
 * The three money fields belong to the platform and the provider together,
 * never to either alone. Bright Data bills a Reddit record at $0.0015 and
 * ScrapeCreators will not bill the same unit at the same price for the same
 * platform, so a price kept on the platform would be one provider's price
 * charged to every provider.
 *
 * Everything the budget guard, the settings form and the registry need before
 * anything is instantiated.
 */
export interface ConnectorDescriptor {
  readonly platform: PlatformDescriptor;
  readonly provider: ProviderDescriptor;
  /**
   * What one billable unit is, singular and lower-case: "call", "post read".
   * Without it the price below is ambiguous, because Reddit and X do not bill
   * the same thing, and neither do two providers fetching Reddit.
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
   * other connector, and would go stale silently the day the connector's own
   * default moved.
   *
   * It is the top of the range a cost test reports for a query whose sample
   * came back full. A sample of ten that was billed ten says only "there was
   * more", and this is how much more there could be.
   */
  readonly maxUnitsPerQueryPoll: number;
  /**
   * Whether this connector can read the replies under a post.
   *
   * The same fact as `SocialSource.fetchReplies` being present, said where a
   * screen can read it without building a connector and without a key. The
   * monitor form needs it: a person who ticks "include replies" on three
   * platforms must be told which of them will actually return any, rather
   * than being given none in silence.
   *
   * Default it to false in a descriptor that does not say. A connector that
   * cannot fetch replies and forgets to declare so is then merely quiet,
   * where the other way round would be a promise the form makes and the
   * connector breaks.
   */
  readonly canFetchReplies?: boolean;
  /**
   * What one call to `fetchReplies` costs, when it differs from
   * `pricePerUnitMicros`.
   *
   * It differs more often than not. On ScrapeCreators a search and a comment
   * page are both one credit; on SocialCrawl an X search is one credit and an
   * X reply page is one, while a Reddit comment call is five against a Reddit
   * search's one. A guard fed the search price for a reply page would let a
   * monitor spend five times its cap, which is the mistake US-028 already made
   * once with LinkedIn credits and wrote down.
   *
   * Absent means the same price as a search.
   */
  readonly replyPricePerUnitMicros?: number;
}

export interface SocialSource extends ConnectorDescriptor {
  validateCredentials(credentials: SourceCredentials): Promise<CredentialCheck>;
  search(request: SearchRequest): Promise<SearchResult>;
  /** Absent means verification is unsupported, never that a post is deleted. */
  verify?(request: VerificationRequest): Promise<VerificationResult>;
  /**
   * Read the replies under one post. Absent means this connector cannot.
   *
   * Absent is the declaration, and it is why `SourceQuery.includeReplies` is
   * ignored rather than refused: a monitor that asks for replies on a platform
   * whose connector has no method here still polls, and still returns posts.
   * `canFetchReplies` on the descriptor is the same fact, readable without
   * building a connector, because the monitor form has to say which of a
   * person's platforms will actually return them.
   *
   * US-020. Every provider we have reads replies by post URL, so this is a
   * second call and not a flag on `search`.
   */
  fetchReplies?(request: ReplyRequest): Promise<ReplyResult>;
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
 * exporting one of these — a platform, a provider, and the pair's economics.
 */
export interface ConnectorDefinition extends ConnectorDescriptor {
  create(runtime: SourceRuntime): SocialSource;
}

/** US-015. A verification carries billing and durable continuation state. */
export interface VerificationRequest {
  readonly externalId: string;
  readonly url: string;
  readonly credentials: SourceCredentials;
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}
export type VerificationResult =
  | { readonly status: "available" | "deleted" | "unknown"; readonly unitsConsumed: number }
  | {
      readonly status: "pending";
      readonly unitsConsumed: number;
      readonly cursor?: string;
      readonly retryAfter: Date;
    };
