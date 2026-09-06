/**
 * YouTube, fetched through SocialCrawl. US-034.
 *
 * The fourth platform, added against PLAN.md's *Important rule* on the owner's
 * decision, and the third this one provider fetches on one key.
 *
 * **A video is not a lead, and this connector is built around that.** US-034
 * searched `flaky tests` live and every one of the first twelve results was a
 * tutorial — "How To Fix Flaky Tests In CI/CD", "3 Steps to Fix Flaky Tests", a
 * conference talk. Not one was a person with the problem. That is not a bad
 * query; it is what the platform is, because a video is something somebody
 * published to be seen. The lead is in the comments underneath, so a YouTube
 * monitor without `includeReplies` is a monitor that will find nothing.
 *
 * Four things the capture measured that the documentation did not say, or said
 * wrongly. `youtube-fixtures/` holds the payloads.
 *
 * 1. **A search date is a guess unless you ask for the real one.** Without
 *    `includeExtras=true`, `published_at` is derived by the upstream from a
 *    relative label such as "2 years ago". Comparing the same 45 results both
 *    ways, it drifted a **median of 62 days and a maximum of 283** — the
 *    documentation warns "up to four months", and this is nine. So this
 *    connector always sends the flag, which is free, and applies `since` to a
 *    date it can trust.
 * 2. **There is an honesty field nothing documents.** A plain result carries
 *    `ext.published_precision` — `"year"`, `"month"` or null — beside the
 *    label. When the flag is set the field is absent, because there is nothing
 *    left to warn about. `since` is refused against an imprecise date rather
 *    than applied to it, so a fresh video is never dropped for a date the
 *    provider itself does not stand behind.
 * 3. **An empty search is billed in full and is not empty.** A phrase that
 *    cannot occur returned twelve unrelated videos and cost a credit. Nothing
 *    here reads a short page as a finished query.
 * 4. **The comment endpoint keeps its promises**, which is rare enough to say.
 *    51 comments for one credit, exact per-second timestamps, strictly
 *    newest-first. `fetchReplies` rests on that ordering and says so.
 */
import { youTubePlatform } from "../../platforms.js";
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
  SocialCrawlClient,
  SocialCrawlError,
  youTubeCommentsProfile,
  youTubeSearchProfile,
} from "./client.js";
import { toCandidateReply } from "./comments.js";
import { socialCrawlProvider } from "./provider.js";

/**
 * The most pages one query may buy in one poll.
 *
 * A page is 45 results here, against X's 20 and LinkedIn's 10, so two pages is
 * already 70 videos and more threads than `maxThreadsPerJob` will open.
 */
const maxPagesPerInput = 2;

/**
 * Ask for the exact publish instant, always.
 *
 * It costs the same as not asking — measured, one credit either way — and
 * without it every date is derived from a phrase like "2 years ago".
 */
const exactDates = "true";

export const socialCrawlYouTube: ConnectorDefinition = {
  platform: youTubePlatform,
  provider: socialCrawlProvider,
  /** One credit a request, whatever the request returns. Measured. */
  billableUnit: "request",
  /**
   * The same 8,118 micro-dollars a credit as X and LinkedIn: one provider, one
   * key, one credit pack. `x.ts` holds the working and the exchange rate.
   *
   * What differs between the three is how many a call takes and how much it
   * brings back. A YouTube search page is one credit for 45 results, which is
   * about 180 micro-dollars a video — the cheapest item this product fetches,
   * and a comment page is cheaper still at one credit for 51.
   */
  pricePerUnitMicros: 8118,
  maxUnitsPerQueryPoll: maxPagesPerInput,
  canFetchReplies: true,
  /** A comment page is one credit, the same as a search. Measured, not assumed. */
  replyPricePerUnitMicros: 8118,
  create: (runtime) => new SocialCrawlYouTubeSource(runtime),
};

/**
 * Where the caller is: which query, how many pages of it this poll has bought,
 * and the provider's own cursor.
 *
 * There is no phase here, unlike Reddit and X. YouTube has one discovery mode
 * in this connector: a keyword search. Channel discovery is deliberately
 * absent for the reason it is absent on LinkedIn — a monitor exists to find a
 * stranger describing a problem, and a named channel is not one.
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
 * The provider's cursor is a long base64 blob with no separator in it today.
 * Rejoining the tail rather than reading one field means a provider that
 * starts using one cannot silently truncate our place in the collection.
 */
function decodeCursor(cursor: string): Cursor {
  const parts = cursor.split(cursorSeparator);
  const index = Number(parts[0]);
  const pages = Number(parts[1]);
  const after = parts.slice(2).join(cursorSeparator);

  if (
    parts.length < 3 ||
    !Number.isInteger(index) ||
    index < 0 ||
    !Number.isInteger(pages) ||
    pages < 0
  ) {
    throw new Error(`${youTubePlatform.id}: cursor "${cursor}" was not issued by this source.`);
  }

  return { index, pages, ...(after ? { after } : {}) };
}

export class SocialCrawlYouTubeSource implements SocialSource {
  readonly platform = socialCrawlYouTube.platform;
  readonly provider = socialCrawlYouTube.provider;
  readonly billableUnit = socialCrawlYouTube.billableUnit;
  readonly pricePerUnitMicros = socialCrawlYouTube.pricePerUnitMicros;
  readonly maxUnitsPerQueryPoll = socialCrawlYouTube.maxUnitsPerQueryPoll;
  readonly canFetchReplies = socialCrawlYouTube.canFetchReplies;
  readonly replyPricePerUnitMicros = socialCrawlYouTube.replyPricePerUnitMicros;

  constructor(private readonly runtime: SourceRuntime) {}

  private client(credentials: SourceCredentials, comments = false): SocialCrawlClient {
    const apiKey = credentials.apiKey;
    if (!apiKey) {
      throw new SocialCrawlError("credentials", "No SocialCrawl API key was given.", 0);
    }
    return new SocialCrawlClient({
      runtime: this.runtime,
      apiKey,
      profile: comments ? youTubeCommentsProfile : youTubeSearchProfile,
    });
  }

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

  async search(request: SearchRequest): Promise<SearchResult> {
    const client = this.client(request.credentials);
    const start =
      request.cursor === undefined ? this.first(request.query) : decodeCursor(request.cursor);

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
          includeExtras: exactDates,
          ...(start.after ? { cursor: start.after } : {}),
        },
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

    const wanted = collected.filter((post) => this.isRecentEnough(post, request.query.since));
    const posts = request.limit === undefined ? wanted : wanted.slice(0, request.limit);

    return {
      posts,
      unitsConsumed: page.creditsUsed,
      next: this.nextAfter(request, start, page),
    };
  }

  /**
   * One page of the comments under one video.
   *
   * `order=newest` is not a preference. A monitor wants what was said since it
   * last looked, and this is the only endpoint in the product where the
   * provider guarantees an ordering that makes that cheap: rows arrive
   * newest-first on an exact timestamp and each page continues strictly older
   * with no overlap. Measured over one full thread on 2026-09-06.
   *
   * **The pinned comment is the trap the provider warns about.** The first row
   * of the first page can be the video's pinned comment whatever the order, so
   * a walk that stopped at the first out-of-window row could stop immediately
   * and return nothing. Nothing here terminates on position; the cut is by
   * timestamp, on every row.
   */
  async fetchReplies(request: ReplyRequest): Promise<ReplyResult> {
    const client = this.client(request.credentials, true);

    const page = await client.fetchPage(
      {
        url: request.postUrl,
        order: "newest",
        ...(request.cursor ? { cursor: request.cursor } : {}),
      },
      request.signal,
    );

    const parsed = page.records
      .map((record, index) =>
        toCandidateReply(record, {
          parentPostExternalId: request.postExternalId,
          position: (request.positionOffset ?? 0) + index,
          // YouTube leaves `url` null on every comment, so this builds the
          // deep link its own Share button produces. `&lc=` names the comment.
          urlFor: (id) => `https://www.youtube.com/watch?v=${request.postExternalId}&lc=${id}`,
        }),
      )
      .filter((reply): reply is CandidateReply => reply !== undefined);

    /**
     * The date cut, and the reason it is a filter rather than a stop.
     *
     * The provider warns that the first row of the first page can be the
     * video's pinned comment whatever the order, so a walk that stopped at the
     * first out-of-window row could stop on row one and return nothing. Every
     * row is tested instead. That is the trap the capture went looking for.
     */
    const replies = request.since
      ? parsed.filter((reply) => reply.postedAt > (request.since as Date))
      : parsed;

    /**
     * Whether paging on would buy anything.
     *
     * This is where the provider's ordering guarantee is finally spent: rows
     * arrive newest-first and each page continues strictly older, so once a
     * page's own oldest row is outside the window, every later page is too.
     * Measured over one full thread on 2026-09-06.
     */
    const oldest = parsed.at(-1)?.postedAt;
    const pastTheWindow =
      request.since !== undefined && oldest !== undefined && oldest <= request.since;

    if (pastTheWindow) {
      return {
        replies,
        itemsReturned: page.records.length,
        unitsConsumed: page.creditsUsed,
        next: { status: "done" },
        partial: false,
      };
    }

    return {
      replies,
      itemsReturned: page.records.length,
      unitsConsumed: page.creditsUsed,
      next: page.cursor ? { status: "ready", cursor: page.cursor } : { status: "done" },
      /**
       * Partial exactly when there is another page, and honestly so.
       *
       * This connector may say `false` where the Reddit one cannot, because
       * the provider's `has_more` was consistent with `total` on every captured
       * answer. That is one thread, so a second capture disagreeing is the
       * thing that would change this line.
       */
      partial: page.cursor !== undefined,
    };
  }

  /**
   * Whether a video is new enough to keep, given what the provider will say
   * about its own date.
   *
   * A video with no usable date is **kept**, not dropped. The alternative
   * drops a fresh video because the provider was vague about it, and a lead
   * nobody sees is the failure this repository keeps writing down. The cost of
   * being wrong the other way is one model call.
   */
  private isRecentEnough(post: CandidatePost, since: Date | undefined): boolean {
    if (!since) return true;

    // The provider said this date is derived from "2 years ago" or similar.
    // Keeping it costs one model call; dropping it loses a video that may have
    // been published this week, and nobody could tell that happened.
    if (post.postedAtIsApproximate) return true;

    return post.postedAt > since;
  }

  private first(query: SourceQuery): Cursor | undefined {
    return query.queries.length > 0 ? { index: 0, pages: 0 } : undefined;
  }

  /**
   * Where the caller comes back to, after a page.
   *
   * Two rules, and both are about not spending money for nothing. A query stops
   * at `maxPagesPerInput` however much more the provider offers, so one query
   * cannot spend a poll's whole budget. And the walk moves to the next query
   * rather than finishing, so a monitor's second query is reached at all.
   */
  private nextAfter(request: SearchRequest, at: Cursor, page: Page): SearchResult["next"] {
    const pages = at.pages + 1;

    if (page.cursor !== undefined && pages < maxPagesPerInput) {
      return { status: "ready", cursor: encodeCursor({ ...at, pages, after: page.cursor }) };
    }

    const nextIndex = at.index + 1;

    if (nextIndex < request.query.queries.length) {
      return { status: "ready", cursor: encodeCursor({ index: nextIndex, pages: 0 }) };
    }

    return { status: "done" };
  }
}

/**
 * One search result to one `CandidatePost`.
 *
 * Field names come from `youtube-fixtures/`, captured from a live account.
 * The provider wraps every platform in one shape — `{ post: { id, url,
 * content, author, engagement, published_at, ext } }` — which is the same
 * envelope the X and LinkedIn connectors read.
 */
export function toCandidatePost(record: unknown): CandidatePost | undefined {
  const item = objectOf(record);
  const post = objectOf(item?.post) ?? item;
  if (!post) return undefined;

  const externalId = text(post.id);
  const url = text(post.url);
  const content = objectOf(post.content);
  const title = text(content?.text);
  const postedAt = dateOf(post.published_at);

  // No id, no url, no date, no words: four different reasons this is not a
  // post, and repairing any of them would be inventing evidence.
  if (!externalId || !url || !postedAt || !title) return undefined;

  const ext = objectOf(post.ext);
  const author = objectOf(post.author);
  const engagement = objectOf(post.engagement);
  const description = text(ext?.description);
  const comments = engagement?.comments;

  /**
   * Whether the date can be trusted, said by the provider rather than guessed.
   *
   * `ext.published_precision` is present only on an answer whose date was
   * derived from a label like "2 years ago" — with `includeExtras=true` the
   * field is absent, because there is nothing left to warn about. So its
   * presence is the warning, and it is carried up rather than dropped: `since`
   * must not be applied to a date the provider itself will not stand behind,
   * and the measured drift is a median of 62 days.
   */
  const precision = text(ext?.published_precision);

  return {
    externalId,
    url,
    ...(precision ? { postedAtIsApproximate: true } : {}),
    // A video's title is its headline and its description is the body. Both
    // are the publisher's words, which is why a video is rarely a lead — but
    // they are what the classifier reads to decide whether the thread beneath
    // is worth opening.
    title,
    text: description ? `${title}\n\n${description}` : title,
    postedAt,
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
