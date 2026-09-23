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
 * **It is the fresh connector, not the cheap one** — it is chosen for the
 * posts under two hours old that the others do not reach. US-056's Log holds
 * what it measured across the three providers, and docs/costs.md holds the
 * price.
 *
 * Four measured facts shape what is below.
 *
 * 1. **`sortBy: "date"` selects recent posts but does not order them.** No
 *    page may be read as older than the next, so `x.ts`'s early-stop rule is
 *    absent here as it is on every LinkedIn connector.
 * 2. **The id is the activity id**, the same number SocialCrawl returns as
 *    `id`, so a post collected there is not bought again here.
 * 3. **The bill settles after the run ends.** `client.ts` owns that, and it is
 *    why `unitsConsumed` is derived from a settled total rather than from the
 *    item count.
 * 4. **A run that matches nothing still costs money.** An empty poll is not a
 *    free poll.
 */
import { linkedInPlatform } from "../../platforms.js";
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

/**
 * How many comments to buy under one post.
 *
 * Ten is the actor's own default and $0.02 on the FREE plan, where a comment
 * is priced exactly like a post. It is the cap that decides what a monitor
 * with replies on costs here, so raising it raises every projected bill — and
 * US-020 already settled the principle for every platform: read the top of a
 * thread and stop, because the model calls are the larger bill.
 */
const commentsPerRun = 10;

/**
 * How many times `fetchReplies` asks whether its run has finished.
 *
 * Twelve asks, `resumeAfterSeconds` apart, so about a minute. The captured
 * comment runs took 6.5 seconds and the captured search runs took 3.3 to 10.5,
 * so a minute is far outside that range on purpose: the money is spent when the
 * run starts, and waiting longer is cheaper than abandoning what was bought.
 */
const maxWaitAttempts = 12;

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
  /**
   * Keywords only. The actor takes `authorUrls` and `authorsCompanies`, which
   * narrow a search to accounts a person already knows — not the channel
   * discovery a monitor means, and untested here besides.
   */
  discovery: ["keyword"],
  /** `postsPerRun`: what one query costs in one poll. */
  maxUnitsPerQueryPoll: postsPerRun,
  /**
   * Comments, since US-159 — and this is the only reply path LinkedIn has.
   *
   * Until this connector read them, a person could tick "include replies" on
   * LinkedIn and be given none, on every provider, silently.
   *
   * **The price question that held it back is answered and it is the good
   * answer**: `post-comment` costs exactly what `post` costs, $0.002 on FREE,
   * read from `harvestapi~linkedin-post-comments`'s own `pricingInfos` — which
   * is free to read, so nobody had to spend to find out. Nobody had asked.
   *
   * What a live run on 2026-09-17 added, on a post claiming two comments:
   *
   * * A comment carries its own id, a deep link that opens it, the words, an
   *   exact ISO date and its author. Nothing has to be built or repaired.
   * * **`replies` arrive nested, and they arrived without being asked for.**
   *   The run with `scrapeReplies: true` returned the same two comments, the
   *   same nested reply and the same two charged events as the run without it.
   *   One post is one measurement; the connector does not send the flag and
   *   does not rely on the nesting being free.
   * * `postedLimit` narrows comments at the provider. It is the first
   *   server-side comment window in this product — `ReplyRequest.since` says
   *   no provider offers one, and that sentence is now out of date here.
   */
  canFetchReplies: true,
  /** A comment is charged like a post: the same event price, the same tiers. */
  replyPricePerUnitMicros: 2000,
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

/**
 * The comment windows, which are the post windows without `1h`.
 *
 * `harvestapi~linkedin-post-comments` publishes `any`, `24h`, `week`, `month`,
 * `3months`, `6months` and `year` — one value short of its sibling, read from
 * its own input schema on 2026-09-17. A connector that reused the list below
 * would send `1h` to an actor that does not offer it, and this provider
 * ignores an unknown value and charges for the run anyway.
 */
const commentWindows = [
  { value: "24h", covers: 24 * 60 * 60 * 1000 },
  { value: "week", covers: 7 * 24 * 60 * 60 * 1000 },
  { value: "month", covers: 31 * 24 * 60 * 60 * 1000 },
  { value: "3months", covers: 92 * 24 * 60 * 60 * 1000 },
  { value: "6months", covers: 184 * 24 * 60 * 60 * 1000 },
  { value: "year", covers: 366 * 24 * 60 * 60 * 1000 },
] as const;

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
  readonly replyPricePerUnitMicros = apifyLinkedIn.replyPricePerUnitMicros;

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
      /**
       * The one input this run was for. US-212.
       *
       * Read from the cursor rather than passed in: this method finishes a run
       * the previous poll started, and the query it was started for is exactly
       * the one the cursor's index names.
       */
      ...(request.query.queries[at.index] === undefined
        ? {}
        : {
            foundBy: { kind: "query" as const, value: request.query.queries[at.index] as string },
          }),
      unitsConsumed: this.unitsOf(run),
      next: onward ? { status: "ready", cursor: encodeCursor(onward) } : { status: "done" },
    };
  }

  /**
   * The comments under one post. US-159, and the only reply path LinkedIn has.
   *
   * **This is the one call in the connector that waits rather than handing the
   * wait back**, and the reason is the caller and not the provider. `search`
   * returns `{ status: "wait" }` and is resumed by the scheduler; the replies
   * worker takes only `ready` or `done` and ends its walk on anything else, so
   * a wait returned here would silently lose the run that was already paid
   * for. The captured runs finished in 6.5 seconds.
   *
   * The wait is bounded, and running out is an error rather than an empty
   * answer. A run that is still going has been started and will be billed, so
   * the honest thing is to say so and name the run, not to report zero
   * comments and zero cost.
   */
  async fetchReplies(request: ReplyRequest): Promise<ReplyResult> {
    const client = this.client(request.credentials);

    const started = await client.startRun(
      actors.linkedInPostComments,
      {
        posts: [request.postUrl],
        /**
         * Never zero, and never absent. The actor's default is ten and its
         * meaning for zero is undocumented — on the search actor zero means
         * *everything there is*, and this provider bills per item returned.
         */
        maxItems: commentsPerRun,
        /** `short`, so no `main-profile` event is charged beside the comment. */
        profileScraperMode: "short",
        ...this.commentWindow(request.since),
      },
      request.signal,
    );

    /**
     * Attempts, not a clock.
     *
     * A loop that compared `runtime.now()` against a deadline would never end
     * under a runtime whose clock does not move — which every test here uses,
     * and which is exactly the shape that hangs a worker instead of failing
     * it. Counting the asks bounds the wait whatever the clock does.
     */
    let running = true;

    for (let attempt = 0; attempt < maxWaitAttempts && running; attempt += 1) {
      running = ApifyClient.isRunning(await client.runStatus(started.runId, request.signal));

      if (running) await this.runtime.sleep(resumeAfterSeconds * 1000);
    }

    if (running) {
      throw new ApifyError(
        "provider",
        `Apify run ${started.runId} was still running after ` +
          `${maxWaitAttempts * resumeAfterSeconds}s. It has been started and will be ` +
          "billed; read it in the Apify console.",
        0,
      );
    }

    const run = await client.readRun(started.runId, request.signal);

    if (run.status !== "SUCCEEDED") {
      this.runtime.logger.warn(
        { platform: linkedInPlatform.id, runId: started.runId, status: run.status },
        "an Apify comments run did not succeed; recording what it cost and moving on",
      );
    }

    /**
     * Depth first, carrying each comment's id down to the replies under it.
     *
     * A nested reply names no parent of its own — there is no `parentId` on
     * the wire — so the only thing that says what it answers is where it sat
     * in the tree. Flattening without carrying that down would store the
     * second half of every conversation as though it answered the post.
     */
    const flattened = flattenComments(run.records);

    const parsed = flattened
      .map(({ record, parentReplyExternalId }, index) =>
        toCandidateReply(record, {
          parentPostExternalId: request.postExternalId,
          position: (request.positionOffset ?? 0) + index,
          ...(parentReplyExternalId ? { parentReplyExternalId } : {}),
        }),
      )
      .filter((reply): reply is CandidateReply => reply !== undefined);

    /**
     * The exact cut, made here because `postedLimit` is a named range at best.
     * The comments were paid for whether they are kept or not, which is why
     * the window is still sent: it is the only comment window in this product
     * that stops the provider collecting what we would throw away.
     */
    const replies = request.since
      ? parsed.filter((reply) => reply.postedAt > (request.since as Date))
      : parsed;

    return {
      replies,
      itemsReturned: flattened.length,
      unitsConsumed: this.unitsOf(run),
      /**
       * Always done. This actor has no cursor: `maxItems` is the whole bound,
       * and asking again would start a second run and buy the same comments a
       * second time — the mistake the run id in `search`'s cursor exists to
       * prevent.
       */
      next: { status: "done" },
      /**
       * Partial when the run returned as many top-level comments as it was
       * allowed to, because then the cap and not the thread decided where it
       * stopped. It is counted on the top level rather than on the flattened
       * tree: `maxItems` is documented as comments per post, and the nested
       * replies arrived beside them without being charged for separately.
       */
      partial: run.records.length >= commentsPerRun,
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
  /**
   * The same idea as `window`, on the comments actor's shorter list.
   *
   * It is the first provider-side comment window this product has. Every other
   * reply endpoint is asked for a thread and cuts the dates itself afterwards,
   * having paid for all of them.
   */
  private commentWindow(since: Date | undefined): Record<string, string> {
    if (!since) return {};

    const age = this.runtime.now().getTime() - since.getTime();
    const window = commentWindows.find((candidate) => age <= candidate.covers);

    return window ? { postedLimit: window.value } : {};
  }

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

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function dateOf(value: unknown): Date | undefined {
  const iso = text(value);
  if (!iso) return undefined;

  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

interface FlatComment {
  readonly record: unknown;
  /** The comment this one is nested under, when it is nested under one. */
  readonly parentReplyExternalId?: string;
}

/**
 * A tree of comments to a flat list, depth first, carrying the parent down.
 *
 * The actor answers with top-level comments, each holding its own `replies`
 * array of the same shape. A nested reply carries no parent id of its own —
 * `postId` names the post for every row, whatever its depth — so the tree is
 * the only thing that says what a reply answers, and the link has to be taken
 * from the walk before the nesting is discarded.
 *
 * Depth is bounded so that a malformed answer ends the walk rather than the
 * process.
 */
export function flattenComments(
  records: readonly unknown[],
  parentReplyExternalId?: string,
  depth = 0,
): readonly FlatComment[] {
  if (depth > 20) return [];

  const out: FlatComment[] = [];

  for (const record of records) {
    const comment = objectOf(record);
    if (!comment) continue;

    out.push({ record, ...(parentReplyExternalId ? { parentReplyExternalId } : {}) });

    const children = comment.replies;
    const id = typeof comment.id === "string" ? comment.id : undefined;

    if (Array.isArray(children) && children.length > 0 && id) {
      out.push(...flattenComments(children, id, depth + 1));
    }
  }

  return out;
}

interface ReplyContext {
  readonly parentPostExternalId: string;
  readonly position: number;
  readonly parentReplyExternalId?: string;
}

/**
 * One captured comment to one `CandidateReply`.
 *
 * Nothing here is built and nothing is repaired, which is unusual in this
 * repository: the actor sends an id, a link that opens the comment, the words,
 * an exact ISO date and an author, and a row missing any of them is dropped.
 * The link was opened on 2026-09-17 and shows the post with that comment.
 *
 * **`postId` carries the urn and `id` does not**, which is the one trap in this
 * shape. A comment says `urn:li:activity:7502584032971595776` where the post it
 * hangs under is stored as `7502584032971595776`, so a parent check that
 * compared them literally would drop every comment it was given. BUG-007's
 * rule is applied to the bare id underneath.
 */
export function toCandidateReply(
  record: unknown,
  { parentPostExternalId, position, parentReplyExternalId }: ReplyContext,
): CandidateReply | undefined {
  const comment = objectOf(record);
  if (!comment) return undefined;

  const externalId = text(comment.id);
  const url = text(comment.linkedinUrl);
  const body = text(comment.commentary);
  const postedAt = dateOf(comment.createdAt);

  if (!externalId || !url || !body || !postedAt) return undefined;

  const belongsTo = bareActivityId(text(comment.postId));
  if (belongsTo && belongsTo !== parentPostExternalId) return undefined;

  const author = text(objectOf(comment.actor)?.name);
  const replyCount = objectOf(comment.engagement)?.comments;

  return {
    externalId,
    url,
    ...(author ? { author } : {}),
    text: body,
    postedAt,
    parentPostExternalId,
    ...(parentReplyExternalId ? { parentReplyExternalId } : {}),
    threadPosition: position,
    ...(typeof replyCount === "number" && Number.isFinite(replyCount) && replyCount >= 0
      ? { replyCount }
      : {}),
  };
}

/**
 * `urn:li:activity:7502584032971595776` to `7502584032971595776`.
 *
 * A value with no urn wrapper is returned as it is, because the actor is free
 * to start sending the bare id and a parser that demanded the prefix would
 * then drop everything.
 */
function bareActivityId(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const last = value.split(":").at(-1);
  return last && last !== "" ? last : undefined;
}
