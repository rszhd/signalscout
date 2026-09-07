/**
 * LinkedIn, reached through HarvestAPI's actor on Apify.
 *
 * Correctness-critical: cursor and deduplication. The failure this file has to
 * avoid is the same post fetched and billed twice — and here that has a second
 * shape nobody else has. This provider bills **per post returned**, and a run
 * is asynchronous, so a poll that is interrupted and then starts a *new* run
 * pays again for the posts the first one already collected. The run id lives in
 * the cursor for exactly that reason. BUG-001 taught this repository the
 * lesson on Bright Data; it costs more here, because Bright Data at least
 * returns a snapshot you can come back to.
 *
 * This file is one connector: the LinkedIn platform and the Apify provider, and
 * the price that pair bills. The platform is described in
 * `sources/platforms.ts` and the provider in `./provider.ts`.
 *
 * US-057 added it because US-056 measured three providers for one platform and
 * this is the only one that answers "who said this in the last hour".
 *
 * **Every post in the capture was under ninety minutes old** — ten posts across
 * a 71-minute page. ScrapeCreators' newest was three days old and SocialCrawl
 * orders by relevance across weeks. This connector is not the cheap one: fifty
 * posts cost $0.10 on a free Apify plan, against $0.0094 through ScrapeCreators
 * and $0.2030 through SocialCrawl. It is the fresh one, and US-052 already
 * argued why that is what a lead is worth.
 *
 * Four measured facts shape what is below.
 *
 * 1. **`sortBy: "date"` selects recent posts but does not order them.** The
 *    captured ten came back 04:43, 04:30, 04:29, 05:15, 05:14, 04:48, 04:37,
 *    04:11, 04:04, 05:12. So no page may be read as older than the next, and
 *    `x.ts`'s early-stop rule is absent here as it is on every LinkedIn
 *    connector.
 * 2. **The id is the activity id**, the same number SocialCrawl returns as
 *    `id`, so a post collected there is not bought again here.
 * 3. **The bill settles after the run ends.** `client.ts` owns that, and it is
 *    why `unitsConsumed` is derived from a settled total rather than from the
 *    item count.
 * 4. **A run that matches nothing still costs $0.00105.** An empty poll is not
 *    a free poll.
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
import type { FinishedRun } from "./client.js";
import { ApifyClient, ApifyError, actors } from "./client.js";
import { apifyProvider } from "./provider.js";

/**
 * How many posts one query may buy in one poll.
 *
 * This is the whole budget for a query here, because this connector runs the
 * actor once per query rather than paging: the actor's `startPage` and
 * `scrapePages` were never exercised by the capture, and an unproven paging
 * parameter is not something to spend somebody's money discovering.
 *
 * Twenty-five against the ten the capture asked for. The budget guard reads it
 * as `maxUnitsPerQueryPoll` and US-014's cost test multiplies it by the polls
 * in a month, so raising it raises every projected bill.
 */
const postsPerRun = 25;

/**
 * How long to wait before asking whether a run has finished.
 *
 * Runs took 3.3, 6.6 and 10.5 seconds in the capture. Five is inside that
 * range rather than beyond it: the poll hands the wait back to the scheduler,
 * so a resume that is slightly early costs one cheap status call and a resume
 * that is late costs the freshness this connector exists for.
 */
const resumeAfterSeconds = 5;

export const apifyLinkedIn: ConnectorDefinition = {
  platform: linkedInPlatform,
  provider: apifyProvider,
  /**
   * The post, because that is what the actor charges for.
   *
   * Not the request: a run returning twenty-five posts costs twenty-five times
   * one returning one, which is the opposite of both other LinkedIn providers.
   * A connector reporting "1 run" against a per-post price would let a monitor
   * spend twenty-five times its cap before anything refused it — the same trap
   * US-028 found on LinkedIn and US-049 found on Instagram, arriving a third
   * time from a third direction.
   */
  billableUnit: "post",
  /**
   * 2,000 micro-dollars a post: the FREE and BRONZE tier price, read from the
   * actor's own `pricingInfos` on 2026-09-07.
   *
   * **The actor's page says $1.50 per 1,000 and that is the GOLD price.** The
   * tiers are $0.002 on FREE and BRONZE, $0.00175 on SILVER and $0.0015 on GOLD
   * and above. The dearest is what goes here, for the reason every connector in
   * this repository gives: a person on a better plan is told they spent more
   * than they did and stops early, and a person told the reverse spends past
   * their cap.
   *
   * A run also costs $0.00005 to start, and one that matches nothing costs
   * $0.001 more. Those are not posts, so they are folded into this unit by
   * `unitsOf` rather than being lost.
   */
  pricePerUnitMicros: 2000,
  /**
   * One. The unit *is* the post: this actor charges for every post it returns,
   * so the price is already per post. Bright Data is the only other connector
   * here where that is true.
   */
  postsPerUnit: 1,
  /** `postsPerRun`: what one query costs in one poll. */
  maxUnitsPerQueryPoll: postsPerRun,
  /**
   * The actor can fetch comments, and this connector does not ask for them.
   *
   * They are a separate charge at the same price as a post, and whether a
   * LinkedIn comment carries a lead is a question nobody has measured — on
   * Instagram and TikTok the comments hold everything and on Reddit they hold
   * the experts. Turning on a per-item charge to find out is a ticket, not a
   * default.
   */
  canFetchReplies: false,
  create: (runtime) => new ApifyLinkedInSource(runtime),
};

/**
 * The windows the actor accepts, narrowest first, with what each one covers.
 *
 * **Unproven.** US-056 asked for `week` and got back 9 of the same 10 posts as
 * an unfiltered search, because a week cannot narrow an answer that is already
 * 71 minutes wide. So the parameter is sent when `since` allows, but nothing
 * here has been shown to change an answer. The exact cut is made below in any
 * case, which is what makes that safe.
 *
 * The seven values are the actor's own, read from its input schema on
 * 2026-09-07. Its store page names four of them. Reading the schema rather
 * than the page is the difference between a window that narrows and a
 * parameter the actor rejects, and `any` is left out because sending no window
 * says the same thing without a value to get wrong.
 */
const day = 24 * 60 * 60 * 1000;

const windows = [
  { value: "1h", covers: 60 * 60 * 1000 },
  { value: "24h", covers: day },
  { value: "week", covers: 7 * day },
  { value: "month", covers: 31 * day },
  { value: "3months", covers: 92 * day },
  { value: "6months", covers: 184 * day },
  { value: "year", covers: 366 * day },
] as const;

/**
 * Where the caller is: which query, and the run started for it.
 *
 * The run id is the part that matters. Without it a resumed poll starts a
 * second run for a query the first run already collected, and this provider
 * charges for every post it returns — so the same twenty-five posts are bought
 * twice and deduplication hides the fact by storing nothing new.
 */
interface Cursor {
  readonly index: number;
  readonly runId?: string;
}

const cursorSeparator = "|";

function encodeCursor({ index, runId }: Cursor): string {
  return [index, runId ?? ""].join(cursorSeparator);
}

function decodeCursor(cursor: string): Cursor {
  const parts = cursor.split(cursorSeparator);
  const index = Number(parts[0]);
  const runId = parts.slice(1).join(cursorSeparator);

  // A cursor the caller invented, not one we issued. Reading it as an empty
  // page would report the query finished and lose everything after it.
  if (parts.length < 2 || !Number.isInteger(index) || index < 0) {
    throw new Error(`${linkedInPlatform.id}: cursor "${cursor}" was not issued by this source.`);
  }

  return { index, ...(runId ? { runId } : {}) };
}

export class ApifyLinkedInSource implements SocialSource {
  readonly platform = apifyLinkedIn.platform;
  readonly provider = apifyLinkedIn.provider;
  readonly billableUnit = apifyLinkedIn.billableUnit;
  readonly pricePerUnitMicros = apifyLinkedIn.pricePerUnitMicros;
  readonly maxUnitsPerQueryPoll = apifyLinkedIn.maxUnitsPerQueryPoll;
  // The declaration has to reach the instance, not only the definition: every
  // screen and every step asks the connector the registry built, not the
  // record it was built from. US-034 found that wrong on another connector.
  readonly canFetchReplies = apifyLinkedIn.canFetchReplies;

  constructor(private readonly runtime: SourceRuntime) {}

  private client(credentials: SourceCredentials): ApifyClient {
    const apiToken = credentials.apiToken;
    if (!apiToken) {
      throw new ApifyError("credentials", "No Apify API token was given.", 0);
    }
    return new ApifyClient({ runtime: this.runtime, apiToken });
  }

  /**
   * Check a token without spending anything.
   *
   * The probe reads the account rather than running the actor, so nothing can
   * be charged by finding out whether a token is real. Measured on 2026-09-07:
   * a bad token answers 401 `user-or-token-not-found` and no run starts.
   *
   * A refusal and an unreachable provider are different answers, and this
   * returns the first while throwing the second: they lead to different
   * actions, and a person whose provider is down must not be told to replace a
   * working token. docs/secrets.md, *Testing before storing*.
   */
  async validateCredentials(credentials: SourceCredentials): Promise<CredentialCheck> {
    if (!credentials.apiToken) {
      return { valid: false, reason: "Enter your Apify API token." };
    }

    try {
      await this.client(credentials).probe();
    } catch (error) {
      if (error instanceof ApifyError && error.kind === "credentials") {
        return { valid: false, reason: error.message };
      }
      throw error;
    }

    return { valid: true };
  }

  /**
   * Start a run, or finish the one this cursor names.
   *
   * Three states, and the middle one is what makes this connector different
   * from both other LinkedIn ones: there is no run yet, a run is still going,
   * or a run has finished and its dataset is ready. The scheduler is handed the
   * wait rather than being blocked through it, so another monitor can poll
   * while this actor works.
   */
  async search(request: SearchRequest): Promise<SearchResult> {
    const client = this.client(request.credentials);
    const start =
      request.cursor === undefined ? this.first(request.query) : decodeCursor(request.cursor);

    // Said once per poll rather than silently. This actor filters by author, not
    // by a channel a person can name in a monitor, so a monitor that named one
    // would otherwise be quietly given a search across all of LinkedIn.
    if (request.cursor === undefined && request.query.channels.length > 0) {
      this.runtime.logger.debug(
        { platform: linkedInPlatform.id, channels: request.query.channels.length },
        "LinkedIn channels are not searched: this actor takes queries and author URLs.",
      );
    }

    if (!start) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    const query = request.query.queries[start.index];

    // The cursor points past the end of what this monitor names, which happens
    // when a monitor's queries were edited between two polls. Finishing is the
    // safe answer: the next poll starts again from the first query.
    if (query === undefined) return { posts: [], unitsConsumed: 0, next: { status: "done" } };

    try {
      return start.runId
        ? await this.finish(client, request, start, start.runId)
        : await this.begin(client, request, start, query);
    } catch (error) {
      // A rate limit is the one failure the caller can act on by waiting. It is
      // handed up rather than slept through, so the scheduler can run another
      // monitor meanwhile. This branch has never been reached against the real
      // provider: no capture run has been rate-limited.
      if (error instanceof ApifyError && error.kind === "rateLimit") {
        return {
          posts: [],
          unitsConsumed: 0,
          next: {
            status: "wait",
            retryAfter: error.retryAfter ?? this.secondsFromNow(60),
            cursor: encodeCursor(start),
          },
        };
      }
      throw error;
    }
  }

  /**
   * Start the run for one query and hand the wait back.
   *
   * Nothing is billed by starting, so `unitsConsumed` is zero here and the
   * whole charge lands on the poll that reads the run. That is the same split
   * the Bright Data connector makes, and for the same reason: the provider
   * bills for the work, not for the request that asked for it.
   */
  private async begin(
    client: ApifyClient,
    request: SearchRequest,
    at: Cursor,
    query: string,
  ): Promise<SearchResult> {
    const run = await client.startRun(
      actors.linkedInPostSearch,
      {
        searchQueries: [query],
        // Never zero. Zero means *every post there is* on this actor, and this
        // connector bills per post returned.
        maxPosts: postsPerRun,
        sortBy: "date",
        ...this.window(request.query.since),
      },
      request.signal,
    );

    return {
      posts: [],
      unitsConsumed: 0,
      next: {
        status: "wait",
        retryAfter: this.secondsFromNow(resumeAfterSeconds),
        cursor: encodeCursor({ ...at, runId: run.runId }),
      },
    };
  }

  /** Read the run this cursor names, or wait for it again. */
  private async finish(
    client: ApifyClient,
    request: SearchRequest,
    at: Cursor,
    runId: string,
  ): Promise<SearchResult> {
    const status = await client.runStatus(runId, request.signal);

    if (ApifyClient.isRunning(status)) {
      return {
        posts: [],
        unitsConsumed: 0,
        next: {
          status: "wait",
          retryAfter: this.secondsFromNow(resumeAfterSeconds),
          cursor: encodeCursor(at),
        },
      };
    }

    const run = await client.readRun(runId, request.signal);

    const collected = run.records
      .map((record) => toCandidatePost(record))
      .filter((post): post is CandidatePost => post !== undefined);

    // The exact cut, made here because the actor's window is a named range at
    // best and unproven at that. A post older than `since` arrives whether we
    // asked for it or not — and it was paid for either way, which is why the
    // window is still sent.
    const wanted = collected.filter(
      (post) => !request.query.since || post.postedAt > request.query.since,
    );

    // Truncating saves nothing here, and that is worth saying plainly: this
    // provider charged for every record the run returned, before the caller's
    // limit was applied. On a per-request provider a trimmed page wastes
    // nothing; on this one it wastes the difference.
    const posts = request.limit === undefined ? wanted : wanted.slice(0, request.limit);

    if (run.status !== "SUCCEEDED") {
      this.runtime.logger.warn(
        { platform: linkedInPlatform.id, runId, status: run.status },
        "an Apify run did not succeed; recording what it cost and moving on",
      );
    }

    const onward = this.advance(request.query, at);

    return {
      posts,
      unitsConsumed: this.unitsOf(run),
      next: onward ? { status: "ready", cursor: encodeCursor(onward) } : { status: "done" },
    };
  }

  /**
   * What to charge the monitor for one run, in whole posts.
   *
   * The settled bill divided by the price of a post, rounded up. It is not the
   * item count: a run costs $0.00005 to start whatever it returns, and one that
   * matches nothing costs $0.001 more, so counting posts would report an empty
   * poll as free and let a monitor make them all month.
   *
   * Rounding up over-reports by less than one post per run. That is the
   * direction this repository always rounds: a guard that under-reports spends
   * past a cap and says it did not.
   */
  private unitsOf(run: FinishedRun): number {
    return Math.ceil(run.costMicros / apifyLinkedIn.pricePerUnitMicros);
  }

  /** The first query, or nothing if the monitor named none for this platform. */
  private first(query: SourceQuery): Cursor | undefined {
    return query.queries.length > 0 ? { index: 0 } : undefined;
  }

  /** The query after this one, or nothing. */
  private advance(query: SourceQuery, at: Cursor): Cursor | undefined {
    const index = at.index + 1;
    return index < query.queries.length ? { index } : undefined;
  }

  /**
   * The narrowest window that still covers everything the caller asked for.
   *
   * Widening rather than narrowing: too narrow silently loses posts, and the
   * cut below is exact in any case. A `since` older than a month, or none at
   * all, sends no window — which on this actor means whatever `sortBy: "date"`
   * gives, and that was a 71-minute page.
   */
  private window(since: Date | undefined): Record<string, string> {
    if (!since) return {};

    const age = this.runtime.now().getTime() - since.getTime();
    const window = windows.find((candidate) => age <= candidate.covers);

    return window ? { postedLimit: window.value } : {};
  }

  private secondsFromNow(seconds: number): Date {
    return new Date(this.runtime.now().getTime() + seconds * 1000);
  }
}

/**
 * One HarvestAPI item to one `CandidatePost`.
 *
 * Field names come from `linkedin-fixtures/*.json`, captured from a live
 * account. Every field is checked rather than trusted: a post whose id or
 * timestamp is missing is not one we can store or deduplicate, and such a
 * record is dropped, not repaired.
 *
 * Only the fields `posts` has a column for are read. The actor also returns
 * engagement counts, reaction ids, comment ids, post images, the author's
 * follower count and their whole professional headline; keeping the least we
 * can is what makes honouring a deletion cheap. STACK.md, *Honor deletions*.
 */
export function toCandidatePost(record: unknown): CandidatePost | undefined {
  if (typeof record !== "object" || record === null) return undefined;

  const row = record as Record<string, unknown>;

  /**
   * The activity id, which this actor gives directly.
   *
   * It is the same number SocialCrawl returns as its own `id` and the one
   * ScrapeCreators hides inside a post URL, so `posts` — keyed by
   * `(source, external_id)` with the provider outside the key — will not store
   * a post twice because a deployment changed provider. That is the LinkedIn
   * equivalent of the `t3_` fullname Reddit's providers share.
   */
  const externalId = text(row.id);
  const url = text(row.linkedinUrl);
  const postedAt = timestampOf(row.postedAt);

  if (!externalId || !url || !postedAt) return undefined;

  const author =
    typeof row.author === "object" && row.author !== null
      ? (row.author as Record<string, unknown>)
      : undefined;

  const handle = author ? profileSlug(text(author.linkedinUrl)) : undefined;

  return {
    externalId,
    url,
    /**
     * The post text is under `content`, and there is no second text field.
     * `CandidatePost.title` is left empty because this platform has no title,
     * and repeating the body into one would be a fiction.
     *
     * A post with no words is a post with only an image. The classifier is
     * given an empty string rather than nothing, and scores it as noise, which
     * is what a picture with no words is to a monitor reading for intent.
     */
    text: text(row.content) ?? "",
    postedAt,
    ...(handle ? { author: handle } : {}),
  };
}

/**
 * The publish instant, out of the object this actor wraps it in.
 *
 * `postedAt` is `{ timestamp, date, postedAgoShort, postedAgoText }`. The two
 * usable fields are read in order and the two human ones are ignored: "57
 * minutes ago" is a string about when somebody looked, not about when the post
 * was written.
 */
function timestampOf(value: unknown): Date | undefined {
  const row = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  const iso = text(row.date);
  if (iso) {
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const epoch = row.timestamp;
  if (typeof epoch === "number" && Number.isFinite(epoch)) {
    const parsed = new Date(epoch);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return undefined;
}

/**
 * The profile slug out of an author URL: `linkedin.com/in/<slug>`.
 *
 * The slug is stored rather than the author's name, and the two are not
 * interchangeable. A display name is not unique, it is not stable, and it is
 * the field a person changes when they add a credential to it. A slug
 * identifies the account, which is what a column called `author` is for.
 *
 * The URL arrives with a query string carrying the member's own id, and the
 * slug is taken from the path, so the query is dropped with everything else in
 * it.
 */
function profileSlug(url: string | undefined): string | undefined {
  if (!url) return undefined;

  const match = url.match(/linkedin\.com\/(?:in|company|school|showcase)\/([^/?#]+)/i);
  return match ? match[1] : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
