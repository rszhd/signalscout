/**
 * Reddit, reached through Bright Data.
 *
 * Correctness-critical: cursor and deduplication. The failure this file has to
 * avoid is the same post fetched and billed twice. Bright Data bills at
 * collection time, so a connector that re-triggers a query it has already
 * collected pays for it again and returns the same posts. The cursor below is
 * what stops that, and `reddit.test.ts` pins it.
 *
 * This file is one connector: the Reddit platform and the Bright Data
 * provider, and the price that pair bills. The platform is described in
 * `sources/platforms.ts` and the provider in `./provider.ts`, so a second
 * provider for Reddit adds a file beside this one and edits neither of them.
 *
 * A user connects *Reddit*. Nothing downstream of this folder learns which
 * provider answered. STACK.md, *A source is not a provider*.
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
  VerificationRequest,
  VerificationResult,
} from "../../types.js";
import { BrightDataClient, BrightDataError, datasets, dateRangeFor } from "./client.js";
import { brightDataProvider } from "./provider.js";

/**
 * How many records to collect per input when the caller sets no limit.
 *
 * Every record is billed, so an unbounded default would let one poll spend a
 * month's free allowance. Permissive enough to be useful, small enough that
 * the mistake is cheap.
 */
const defaultRecordsPerInput = 50;

export const brightDataReddit: ConnectorDefinition = {
  platform: redditPlatform,
  provider: brightDataProvider,
  /**
   * Bright Data bills per record returned, not per call. This is the field
   * that stops the budget guard assuming Reddit's old one-call-per-page
   * pricing, and it is why `unitsConsumed` can never be the page length.
   */
  billableUnit: "record",
  /** $1.50 per 1,000 records. STACK.md, *Source economics*. */
  pricePerUnitMicros: 1500,
  /**
   * One. The unit *is* the post: this provider bills every record it collects,
   * so a record and a post are the same thing and the price is already per
   * post. It is the only connector here where that is true.
   */
  postsPerUnit: 1,
  /** Keywords across Reddit, and a subreddit listing. Both proven live in US-022. */
  discovery: ["keyword", "channel"],
  /** `defaultRecordsPerInput`: what one keyword collects when nobody says otherwise. */
  maxUnitsPerQueryPoll: defaultRecordsPerInput,
  create: (runtime) => new RedditSource(runtime),
};

/**
 * Keywords and subreddits are two discovery modes, and one collection carries
 * one of them. A monitor may name both, so the connector runs them in turn.
 */
const phases = ["keyword", "subreddit"] as const;
type Phase = (typeof phases)[number];

/**
 * A cursor names the phase, the snapshot, and how far into it the caller has
 * read.
 *
 * All three are load-bearing. The phase is what lets a monitor that named both
 * keywords and subreddits reach its subreddits at all: without it the caller
 * finishes the keyword collection, starts again from the beginning, and
 * collects the same keywords for ever while the subreddits are never asked
 * for. The snapshot id stops a second poll paying to collect a query already
 * collected. The offset lets a page be shorter than what was collected without
 * losing the rest — "a short page is not the last page", from the connector's
 * side.
 */
interface Cursor {
  readonly phase: Phase;
  readonly snapshotId: string;
  readonly offset: number;
}

const cursorSeparator = "|";

function encodeCursor({ phase, snapshotId, offset }: Cursor): string {
  return [phase, snapshotId, offset].join(cursorSeparator);
}

function decodeCursor(cursor: string): Cursor {
  const parts = cursor.split(cursorSeparator);
  const [phase, snapshotId, rawOffset] = parts;
  const offset = Number(rawOffset);

  // A cursor the caller invented, not one we issued. Reading it as an empty
  // page would report the query finished and lose everything after it.
  if (
    parts.length !== 3 ||
    !phases.includes(phase as Phase) ||
    !snapshotId ||
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    throw new Error(`${redditPlatform.id}: cursor "${cursor}" was not issued by this source.`);
  }

  return { phase: phase as Phase, snapshotId, offset };
}

/** One Bright Data input row: a keyword search, or a subreddit listing. */
type Input =
  | { readonly keyword: string; readonly date: string; readonly num_of_posts: number }
  | { readonly url: string; readonly sort_by: string };

export class RedditSource implements SocialSource {
  readonly platform = brightDataReddit.platform;
  readonly provider = brightDataReddit.provider;
  readonly billableUnit = brightDataReddit.billableUnit;
  readonly pricePerUnitMicros = brightDataReddit.pricePerUnitMicros;
  readonly maxUnitsPerQueryPoll = brightDataReddit.maxUnitsPerQueryPoll;

  constructor(private readonly runtime: SourceRuntime) {}

  /** Correctness-critical: only a matching record with an explicit removal signal
   * hides content. A missing record or failed snapshot leaves it visible.
   * deletion-fixtures/verify.test.ts replays the live answers.
   */
  async verify(request: VerificationRequest): Promise<VerificationResult> {
    const client = this.client(request.credentials);
    if (!request.cursor) {
      const cursor = await client.trigger({
        dataset: datasets.posts,
        inputs: [{ url: request.url }],
        signal: request.signal,
      });
      return {
        status: "pending",
        cursor,
        unitsConsumed: 0,
        retryAfter: new Date(this.runtime.now().getTime() + 30000),
      };
    }
    const snapshot = await client.snapshot(request.cursor, request.signal);
    if (snapshot.status === "pending")
      return {
        status: "pending",
        cursor: request.cursor,
        unitsConsumed: 0,
        retryAfter: snapshot.retryAfter,
      };
    const unitsConsumed = snapshot.billedRecords;
    const id = request.externalId.replace(/^t3_/, "");
    for (const value of snapshot.records) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      const input = row.input as { url?: unknown } | undefined;
      if (
        row.error_code === "dead_page" &&
        row.error === "Reddit post was not found in JSON API response" &&
        input?.url === request.url
      )
        return { status: "deleted", unitsConsumed };
      if (typeof row.post_id !== "string" || row.post_id.replace(/^t3_/, "") !== id || row.error)
        continue;
      const deleted =
        (row.user_posted === "[deleted]" && row.title === "[deleted by user]") ||
        row.description === "[deleted]" ||
        row.description === "[removed]";
      if (deleted) return { status: "deleted", unitsConsumed };
      if (typeof row.title === "string" && typeof row.date_posted === "string")
        return { status: "available", unitsConsumed };
    }
    return { status: "unknown", unitsConsumed };
  }

  private client(credentials: SourceCredentials): BrightDataClient {
    const apiKey = credentials.apiKey;
    if (!apiKey) {
      throw new BrightDataError("credentials", "No Bright Data API key was given.", 0);
    }
    return new BrightDataClient({ runtime: this.runtime, apiKey });
  }

  /**
   * Check a key without spending anything.
   *
   * The probe sends an empty input list. An empty list cannot start a
   * collection, so the request is free whatever the key turns out to be, and a
   * user can save their settings without being billed for finding out they
   * typed it correctly. A bad key is refused at 401 before the input is read;
   * a good one gets far enough to complain that there is nothing to collect.
   * `fixtures/credentials-accepted.json` and `credentials-rejected.json` are
   * those two answers.
   */
  async validateCredentials(credentials: SourceCredentials): Promise<CredentialCheck> {
    if (!credentials.apiKey) {
      return { valid: false, reason: "Enter your Bright Data API key." };
    }

    try {
      await this.client(credentials).trigger({
        dataset: datasets.posts,
        discoverBy: "keyword",
        inputs: [],
      });
    } catch (error) {
      if (error instanceof BrightDataError) {
        // "There is nothing to collect" is the success case: the key got past
        // authentication. Anything else is the user's problem to fix, and the
        // client already phrased it as an instruction.
        if (error.kind === "input" || /no data to trigger/i.test(error.message)) {
          return { valid: true };
        }
        return { valid: false, reason: error.message };
      }
      throw error;
    }

    // A trigger that succeeded on an empty list is not something the provider
    // has ever done. Treat it as working rather than inventing a failure.
    return { valid: true };
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    const client = this.client(request.credentials);

    if (request.cursor === undefined) {
      return this.startFrom(client, request, "keyword");
    }

    return this.readCollection(client, request, decodeCursor(request.cursor));
  }

  /**
   * Trigger the collection and hand the wait back.
   *
   * The connector does not poll here. A collection took just under two minutes
   * in the capture run, and holding a worker for that is a worker not doing
   * the other monitors. `next.status === "wait"` is the interface's answer to
   * exactly this, so the scheduler goes and does something else.
   *
   * Nothing is billed by a trigger, so `unitsConsumed` is zero. The charge
   * appears on the page that reads the finished snapshot.
   */
  private async startCollection(
    client: BrightDataClient,
    request: SearchRequest,
    phase: Phase,
  ): Promise<SearchResult | undefined> {
    const inputs = this.inputsFor(request.query, request.limit, phase);

    // Nothing to ask for in this phase. The caller gets `undefined` so the
    // next phase, or `done`, can answer instead: triggering an empty list
    // would be a request the provider refuses, surfaced as a provider fault.
    if (inputs.length === 0) return undefined;

    const snapshotId = await client.trigger({
      dataset: datasets.posts,
      discoverBy: phase === "keyword" ? "keyword" : "subreddit_url",
      inputs,
      limitPerInput: this.recordsPerInput(request.limit, inputs.length),
      ...(request.signal ? { signal: request.signal } : {}),
    });

    return {
      posts: [],
      unitsConsumed: 0,
      next: {
        status: "wait",
        retryAfter: new Date(this.runtime.now().getTime() + 30_000),
        cursor: encodeCursor({ phase, snapshotId, offset: 0 }),
      },
    };
  }

  /** Start the first phase that has anything to ask for, or report done. */
  private async startFrom(
    client: BrightDataClient,
    request: SearchRequest,
    from: Phase,
  ): Promise<SearchResult> {
    for (const phase of phases.slice(phases.indexOf(from))) {
      const started = await this.startCollection(client, request, phase);
      if (started) return started;
    }

    return { posts: [], unitsConsumed: 0, next: { status: "done" } };
  }

  /**
   * Read a snapshot the caller was told to come back for.
   *
   * The billed count is reported only by the page that reads offset zero. The
   * records were collected once and billed once; charging again for paging
   * through them would put a cost on the user's card that no fetch caused.
   */
  private async readCollection(
    client: BrightDataClient,
    request: SearchRequest,
    cursor: Cursor,
  ): Promise<SearchResult> {
    const state = await client.snapshot(cursor.snapshotId, request.signal ?? undefined);

    if (state.status === "pending") {
      return {
        posts: [],
        unitsConsumed: 0,
        next: {
          status: "wait",
          retryAfter: state.retryAfter,
          cursor: encodeCursor(cursor),
        },
      };
    }

    const all = state.records
      .map((record) => toCandidatePost(record))
      .filter((post): post is CandidatePost => post !== undefined)
      .filter((post) => !request.query.since || post.postedAt > request.query.since);

    const take = request.limit ?? all.length;
    const page = all.slice(cursor.offset, cursor.offset + take);
    const nextOffset = cursor.offset + page.length;
    const unitsConsumed = cursor.offset === 0 ? state.billedRecords : 0;

    if (nextOffset < all.length) {
      return {
        posts: page,
        unitsConsumed,
        next: { status: "ready", cursor: encodeCursor({ ...cursor, offset: nextOffset }) },
      };
    }

    // This phase is finished. If the monitor named subreddits as well as
    // keywords, they are collected now; the charge for the phase just read
    // still travels with this page.
    const nextPhase = phases[phases.indexOf(cursor.phase) + 1];
    if (nextPhase) {
      const started = await this.startCollection(client, request, nextPhase);
      if (started) return { posts: page, unitsConsumed, next: started.next };
    }

    return { posts: page, unitsConsumed, next: { status: "done" } };
  }

  /** Turn one phase of the monitor's query into Bright Data inputs. */
  private inputsFor(query: SourceQuery, limit: number | undefined, phase: Phase): Input[] {
    if (phase === "keyword") {
      const date = dateRangeFor(query.since, this.runtime.now());
      const perInput = this.recordsPerInput(limit, query.queries.length);
      return query.queries.map((keyword) => ({ keyword, date, num_of_posts: perInput }));
    }

    // "New" rather than "Hot": a monitor wants what was said since it last
    // looked, and a popular six-month-old thread is not a lead.
    return query.channels.map((channel) => ({
      url: `https://www.reddit.com/r/${channel}/`,
      sort_by: "New",
    }));
  }

  /**
   * Split the caller's limit across the inputs, so one poll cannot collect a
   * multiple of what was asked for. Every record over the limit is money spent
   * on posts the caller said it did not want.
   */
  private recordsPerInput(limit: number | undefined, inputs: number): number {
    if (limit === undefined) return defaultRecordsPerInput;
    return Math.max(1, Math.ceil(limit / Math.max(1, inputs)));
  }
}

/**
 * One Bright Data record to one `CandidatePost`.
 *
 * Field names come from `fixtures/*-records.json`, captured from a live
 * account. Every field is checked rather than trusted: `include_errors=true`
 * means a record can arrive that describes a failure instead of a post, and a
 * post whose id or timestamp is missing is not one we can store or
 * deduplicate. Such a record is dropped, not repaired.
 *
 * Only the fields `posts` has a column for are read. The provider also returns
 * karma, community rank, avatars and a bio; keeping the least we can is what
 * makes honouring a deletion cheap. STACK.md, *Honor deletions*.
 */
export function toCandidatePost(record: unknown): CandidatePost | undefined {
  if (typeof record !== "object" || record === null) return undefined;

  const row = record as Record<string, unknown>;

  const externalId = text(row.post_id);
  const url = text(row.url);
  const postedAt = row.date_posted === undefined ? undefined : new Date(String(row.date_posted));

  if (!externalId || !url || !postedAt || Number.isNaN(postedAt.getTime())) return undefined;

  const title = text(row.title);
  const author = text(row.user_posted);
  const channel = text(row.community_name);

  return {
    externalId,
    url,
    // A link post has a title and no body. Falling back to the title keeps the
    // classifier something to read; an empty string would score as noise.
    text: text(row.description) ?? title ?? "",
    postedAt,
    ...(author ? { author } : {}),
    ...(channel ? { channel } : {}),
    ...(title ? { title } : {}),
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
