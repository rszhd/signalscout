/**
 * Forums, fetched through Bright Data's Web Unlocker. US-470.
 *
 * A forum's queries are the addresses of the sections to read, each one's
 * newest-threads list (`forumPlatform`, `search.input: "address"`). A call
 * reads one list, or opens up to `threadsPerCall` of the threads it chose;
 * the cursor carries the threads still to open, so a long walk is many short
 * calls and a rate limit costs nothing already bought.
 *
 * Which threads are new is decided from the list (US-469): pinned ones never;
 * one whose start is exact when it started after `since`; one whose start was
 * read from words a day earlier still, because the board's zone is not on the
 * page; one whose list shows no start when its last activity is newer. The
 * thread's own time decides again once it is open. A page no parser knows is
 * skipped and logged with its address. One list page a poll: hourly polls
 * rarely bring more new threads than a page holds.
 */
import { detectForum } from "../../forums/index.js";
import type { ForumThreadSummary } from "../../forums/types.js";
import { forumPlatform } from "../../platforms.js";
import type {
  CandidatePost,
  ConnectorDefinition,
  CredentialCheck,
  SearchRequest,
  SearchResult,
  SocialSource,
  SourceCredentials,
  SourceRuntime,
} from "../../types.js";
import { brightDataProvider } from "./provider.js";
import { fetchThroughUnlocker, UnlockerError } from "./unlocker.js";

/** Threads one call opens. */
export const threadsPerCall = 5;
/**
 * Threads one section may open in one poll, unless the application sets its
 * own (`createBrightDataForum`): the cost cap's figure too.
 */
export const maxThreadsPerSection = 20;
/** How far back a start read from words is trusted to be early. */
const wordsMarginMs = 86_400_000;

interface Pending {
  readonly url: string;
  readonly startedAt?: string;
  readonly approximate: boolean;
}

interface Cursor {
  /** Which section, by its place in the monitor's list. */
  readonly index: number;
  /** Threads chosen from that section's list, not yet opened. */
  readonly pending?: readonly Pending[];
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(cursor: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
    if (Number.isInteger(parsed.index) && parsed.index >= 0) return parsed;
  } catch {
    // Not one of ours: refused below.
  }
  throw new Error(`forum: cursor "${cursor}" was not issued by this source.`);
}

/**
 * What a skipped page was, for its log line: its title and size. A live run on
 * 2026-10-30 got a page no parser read for a thread whose own page, fetched
 * again, read fine; without this the log could not say what came back.
 */
function pageSummary(body: string): { title: string | null; bytes: number } {
  const title = body.match(/<title[^>]*>([\s\S]{0,160}?)<\/title>/i)?.[1]?.trim() ?? null;
  return { title, bytes: body.length };
}

/** Whether a thread on the list is new enough to open. */
export function worthOpening(thread: ForumThreadSummary, since: Date | undefined): boolean {
  if (thread.pinned) return false;
  if (!since) return true;
  if (thread.startedAt) {
    const floor = since.getTime() - (thread.approximateStart ? wordsMarginMs : 0);
    return thread.startedAt.getTime() > floor;
  }
  return (
    !thread.lastActivityAt || thread.lastActivityAt.getTime() > since.getTime() - wordsMarginMs
  );
}

export class BrightDataForumSource implements SocialSource {
  readonly platform = forumPlatform;
  readonly provider = brightDataProvider;
  readonly billableUnit = brightDataForum.billableUnit;
  readonly pricePerUnitMicros = brightDataForum.pricePerUnitMicros;
  readonly postsPerUnit = brightDataForum.postsPerUnit;
  readonly discovery = brightDataForum.discovery;
  readonly maxUnitsPerQueryPoll: number;

  constructor(
    private readonly runtime: SourceRuntime,
    private readonly threadsPerSection = maxThreadsPerSection,
  ) {
    this.maxUnitsPerQueryPoll = 1 + threadsPerSection;
  }

  async validateCredentials(credentials: SourceCredentials): Promise<CredentialCheck> {
    if (!credentials.apiKey) return { valid: false, reason: "Enter your Bright Data API key." };
    if (!credentials.unlockerZone)
      return { valid: false, reason: "Enter the name of your Web Unlocker zone." };
    try {
      // Bright Data's own test page: one request, the cheapest proof the key
      // and the zone work together.
      const answer = await fetchThroughUnlocker(
        this.runtime,
        credentials,
        "https://geo.brdtest.com/welcome.txt",
      );
      return answer.ok ? { valid: true } : { valid: false, reason: answer.reason };
    } catch (error) {
      if (
        error instanceof UnlockerError &&
        (error.kind === "credentials" || error.kind === "input")
      ) {
        return { valid: false, reason: error.message };
      }
      throw error;
    }
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    const sections = request.query.queries;
    const at = request.cursor === undefined ? { index: 0 } : decodeCursor(request.cursor);
    const section = sections[at.index];
    // The monitor's sections changed between two polls: finish, and the next
    // poll starts again from the first.
    if (!section) return { posts: [], unitsConsumed: 0, next: { status: "done" } };
    const foundBy = { kind: "query" as const, value: section };
    const after = (pending: readonly Pending[]): SearchResult["next"] => {
      if (pending.length > 0)
        return { status: "ready", cursor: encodeCursor({ index: at.index, pending }) };
      return at.index + 1 < sections.length
        ? { status: "ready", cursor: encodeCursor({ index: at.index + 1 }) }
        : { status: "done" };
    };

    try {
      if (at.pending) {
        const batch = at.pending.slice(0, threadsPerCall);
        const { posts, units } = await this.open(batch, request);
        return {
          posts,
          foundBy,
          unitsConsumed: units,
          next: after(at.pending.slice(threadsPerCall)),
        };
      }

      const answer = await fetchThroughUnlocker(
        this.runtime,
        request.credentials,
        section,
        request.signal,
      );
      if (!answer.ok) {
        this.runtime.logger.warn(
          { section, reason: answer.reason },
          "forum section skipped: not passed through Bright Data",
        );
        return { posts: [], foundBy, unitsConsumed: 0, next: after([]) };
      }
      const program = detectForum(answer.body);
      if (!program) {
        this.runtime.logger.warn(
          { section, page: pageSummary(answer.body) },
          "forum section skipped: no parser knows this page",
        );
        return { posts: [], foundBy, unitsConsumed: 1, next: after([]) };
      }
      const chosen = program
        .listThreads(answer.body, section, this.runtime.now())
        .filter((thread) => worthOpening(thread, request.query.since))
        .slice(0, this.threadsPerSection)
        .map((thread) => ({
          url: program.threadPageUrl?.(thread.url) ?? thread.url,
          ...(thread.startedAt ? { startedAt: thread.startedAt.toISOString() } : {}),
          approximate: thread.approximateStart,
        }));
      return { posts: [], foundBy, unitsConsumed: 1, next: after(chosen) };
    } catch (error) {
      if (error instanceof UnlockerError && error.kind === "rateLimit") {
        return {
          posts: [],
          unitsConsumed: 0,
          next: {
            status: "wait",
            retryAfter: error.retryAfter ?? new Date(this.runtime.now().getTime() + 60_000),
            ...(request.cursor ? { cursor: request.cursor } : {}),
          },
        };
      }
      throw error;
    }
  }

  /** Open each thread, keep the ones whose own time is new enough. */
  private async open(
    batch: readonly Pending[],
    request: SearchRequest,
  ): Promise<{ posts: CandidatePost[]; units: number }> {
    const now = this.runtime.now();
    const since = request.query.since;
    const posts: CandidatePost[] = [];
    let units = 0;
    for (const pending of batch) {
      const answer = await fetchThroughUnlocker(
        this.runtime,
        request.credentials,
        pending.url,
        request.signal,
      );
      if (!answer.ok) {
        this.runtime.logger.warn(
          { thread: pending.url, reason: answer.reason },
          "forum thread skipped: not passed through Bright Data",
        );
        continue;
      }
      units += 1;
      const program = detectForum(answer.body);
      const thread = program?.readThread(answer.body, pending.url, now);
      if (!thread) {
        this.runtime.logger.warn(
          { thread: pending.url, program: program?.id ?? null, page: pageSummary(answer.body) },
          "forum thread skipped: no parser read it",
        );
        continue;
      }
      const startedAt = thread.postedAt ?? (pending.startedAt ? new Date(pending.startedAt) : null);
      const approximate = thread.postedAt
        ? thread.approximatePostedAt
        : pending.approximate || !startedAt;
      const postedAt = startedAt ?? now;
      if (since && postedAt.getTime() <= since.getTime() - (approximate ? wordsMarginMs : 0))
        continue;
      const host = new URL(thread.url).hostname;
      posts.push({
        // A thread id is only unique inside its forum.
        externalId: `${host}:${thread.id}`,
        url: thread.url,
        channel: host,
        title: thread.title,
        text: thread.text || thread.title,
        postedAt,
        ...(approximate ? { postedAtIsApproximate: true } : {}),
      });
    }
    return { posts, units };
  }
}

/**
 * The connector, opening at most `threadsPerSection` threads a section a poll.
 * An application whose readers are not paying sets fewer: each is a request.
 */
export function createBrightDataForum(
  options: { threadsPerSection?: number } = {},
): ConnectorDefinition {
  const threadsPerSection = options.threadsPerSection ?? maxThreadsPerSection;
  if (!Number.isInteger(threadsPerSection) || threadsPerSection < 1) {
    throw new RangeError(
      `threadsPerSection must be a whole number above zero, not ${threadsPerSection}`,
    );
  }
  return {
    platform: forumPlatform,
    provider: brightDataProvider,
    /** Bright Data bills a Web Unlocker request that succeeds; a refusal is free. */
    billableUnit: "request",
    /** $1.50 per 1,000 on pay-as-you-go, read on 2026-10-30. */
    pricePerUnitMicros: 1500,
    /** One thread page is one post. A list page is a request with none. */
    postsPerUnit: 1,
    discovery: ["channel"],
    /** One list and the most threads it may open. */
    maxUnitsPerQueryPoll: 1 + threadsPerSection,
    create: (runtime) => new BrightDataForumSource(runtime, threadsPerSection),
  };
}

export const brightDataForum: ConnectorDefinition = createBrightDataForum();
