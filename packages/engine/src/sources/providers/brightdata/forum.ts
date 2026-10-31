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
 *
 * A page Bright Data cannot pass, a bot check or a refusal, is read again
 * through Browser Use's cloud browser when the application hands its
 * credentials over with a proxy of its own (US-471). One browser serves a
 * call and is stopped when the call ends. A browser page is counted as one
 * Bright Data unit, and each browser started as one more: the measured cost
 * was below that, and Browser Use's own figure settles too late to read here.
 * A failure of the browser skips the page; it never stops the poll.
 *
 * A query may instead be a forum's newest-threads feed (US-473), which covers
 * every section. Where the program's feed holds the first post, its new items
 * are the posts and nothing else is fetched; where it cuts the text, they are
 * the threads to open, as a section's are. Replies are never posts.
 */
import type { FeedItem } from "../../forums/feeds.js";
import { detectForum, feedProgramFor, isReply, readFeed } from "../../forums/index.js";
import type { ForumProgram, ForumThreadSummary } from "../../forums/types.js";
import { forumPlatform } from "../../platforms.js";
import type {
  CandidatePost,
  CompleteRequest,
  CompleteResult,
  ConnectorDefinition,
  CredentialCheck,
  SearchRequest,
  SearchResult,
  SocialSource,
  SourceCredentials,
  SourceRuntime,
} from "../../types.js";
import { hasBrowserCredentials } from "../browseruse/cloud.js";
import { type OpenPageBrowser, openBrowserUse, type PageBrowser } from "../browseruse/pages.js";
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

/** How a page is fetched: Bright Data's unlocker, or the cloud browser. */
export type ForumFetcher = "unlocker" | "browser";

/** One page fetched, for an application that keeps numbers per forum. */
export interface ForumPageEvent {
  readonly host: string;
  readonly url: string;
  /** `home`: a forum's home page, read by an application looking for its feed. */
  readonly page: "home" | "section" | "feed" | "thread";
  readonly via: ForumFetcher;
  /** Read: a parser read it. Unparsed: a page no parser reads. Refused: no page. */
  readonly outcome: "read" | "unparsed" | "refused";
  readonly program: string | null;
  /** Threads the section's list or the feed chose to open. */
  readonly threads?: number;
  /** Posts a feed gave without a page of their own. */
  readonly posts?: number;
  readonly units: number;
  readonly reason?: string;
}

export interface ForumOptions {
  /** Threads one section may open in one poll. */
  readonly threadsPerSection?: number;
  /**
   * Browser Use's key and a proxy's host, port, user and password. Without
   * the proxy the browser is never used: its own costs ten times more.
   */
  readonly browser?: {
    readonly credentials: SourceCredentials;
    /** For tests: a browser that answers from captured pages. */
    readonly open?: OpenPageBrowser;
  };
  /**
   * The application's choice for a forum, by host: "browser" skips Bright
   * Data for a forum known to stop it. Absent: Bright Data first.
   */
  readonly fetcherFor?: (host: string) => ForumFetcher | undefined;
  /** Told of every page fetched. A throw here is logged and ignored. */
  readonly onPage?: (event: ForumPageEvent) => void;
}

/** One page, how it came, and the Bright Data units it is counted as. */
export interface FetchedPage {
  readonly answer:
    | { readonly ok: true; readonly body: string }
    | { readonly ok: false; readonly reason: string };
  readonly via: ForumFetcher;
  readonly units: number;
}

/** Pages one after another, sharing a browser until `close`. */
export interface ForumPageFetcher {
  fetch(url: string): Promise<FetchedPage>;
  close(): Promise<void>;
}

/**
 * Bright Data first, unless the application sends the forum to the browser,
 * and the browser when Bright Data brings back no page. A browser starts at
 * the first page that needs one and serves every later page until `close`,
 * which a caller must reach, an error included: a browser bills until it is
 * stopped. Bright Data's own errors (a refused key, a rate limit) are thrown;
 * the browser's are a page lost.
 */
export function openForumFetcher(
  runtime: SourceRuntime,
  unlocker: SourceCredentials,
  options: Pick<ForumOptions, "browser" | "fetcherFor">,
  signal?: AbortSignal,
): ForumPageFetcher {
  const browser =
    options.browser && hasBrowserCredentials(options.browser.credentials)
      ? options.browser
      : undefined;
  let pages: PageBrowser | null = null;
  return {
    async fetch(url) {
      if (!browser || options.fetcherFor?.(hostOf(url)) !== "browser") {
        const answer = await fetchThroughUnlocker(runtime, unlocker, url, signal);
        if (answer.ok || !browser) return { answer, via: "unlocker", units: answer.ok ? 1 : 0 };
        runtime.logger.info(
          { url, reason: answer.reason },
          "forum page refused through Bright Data; reading it through the browser",
        );
      }
      pages ??= (browser.open ?? openBrowserUse)(runtime, browser.credentials, signal);
      const before = pages.started;
      try {
        const answer = await pages.read(url);
        return { answer, via: "browser", units: 1 + (pages.started - before) };
      } catch (error) {
        // Browser Use out of credit, or a browser that stopped answering: this
        // page is lost, the rest of the poll is not.
        runtime.logger.error({ url, err: error }, "forum page not read through the browser");
        return {
          answer: { ok: false, reason: (error as Error).message },
          via: "browser",
          units: pages.started - before,
        };
      }
    },
    async close() {
      await pages?.close();
      pages = null;
    },
  };
}

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
  private readonly threadsPerSection: number;
  private readonly browser: ForumOptions["browser"] | undefined;

  constructor(
    private readonly runtime: SourceRuntime,
    private readonly options: ForumOptions = {},
  ) {
    this.threadsPerSection = options.threadsPerSection ?? maxThreadsPerSection;
    this.maxUnitsPerQueryPoll = maxUnitsFor(this.threadsPerSection, Boolean(options.browser));
    if (options.browser && !hasBrowserCredentials(options.browser.credentials)) {
      runtime.logger.warn(
        "forum browser fallback off: it needs a Browser Use key and a proxy's host, port, user and password",
      );
    } else {
      this.browser = options.browser;
    }
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
    // One browser for the whole call, started only if a page needs it.
    const fetcher = openForumFetcher(
      this.runtime,
      request.credentials,
      { ...(this.browser ? { browser: this.browser } : {}), ...this.fetcherFor() },
      request.signal,
    );
    try {
      return await this.walk(request, fetcher);
    } finally {
      await fetcher.close();
    }
  }

  private fetcherFor(): Pick<ForumOptions, "fetcherFor"> {
    return this.options.fetcherFor ? { fetcherFor: this.options.fetcherFor } : {};
  }

  private async walk(request: SearchRequest, fetcher: ForumPageFetcher): Promise<SearchResult> {
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
        const { posts, units } = await this.open(batch, request, fetcher);
        return {
          posts,
          foundBy,
          unitsConsumed: units,
          next: after(at.pending.slice(threadsPerCall)),
        };
      }

      const { answer, via, units } = await fetcher.fetch(section);
      const event = { host: hostOf(section), url: section, page: "section" as const, via, units };
      if (!answer.ok) {
        this.runtime.logger.warn(
          { section, via, reason: answer.reason },
          "forum section skipped: no page came back",
        );
        this.tell({ ...event, outcome: "refused", program: null, reason: answer.reason });
        return { posts: [], foundBy, unitsConsumed: units, next: after([]) };
      }
      const feed = readFeed(answer.body, section);
      if (feed) {
        const read = this.fromFeed(feed, section, request.query.since);
        this.tell({
          ...event,
          page: "feed",
          outcome: "read",
          program: read.program,
          threads: read.chosen.length,
          posts: read.posts.length,
        });
        return { posts: read.posts, foundBy, unitsConsumed: units, next: after(read.chosen) };
      }
      const program = detectForum(answer.body);
      if (!program) {
        this.runtime.logger.warn(
          { section, via, page: pageSummary(answer.body) },
          "forum section skipped: no parser knows this page",
        );
        this.tell({ ...event, outcome: "unparsed", program: null });
        return { posts: [], foundBy, unitsConsumed: units, next: after([]) };
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
      this.tell({ ...event, outcome: "read", program: program.id, threads: chosen.length });
      return { posts: [], foundBy, unitsConsumed: units, next: after(chosen) };
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

  /** A feed's new threads: the posts, or the pages to open for them. */
  private fromFeed(
    feed: readonly FeedItem[],
    address: string,
    since: Date | undefined,
  ): { posts: CandidatePost[]; chosen: Pending[]; program: string | null } {
    const program = feedProgramFor(address);
    const fresh = feed.filter(
      (item) =>
        !isReply(item) &&
        (!since || !item.publishedAt || item.publishedAt.getTime() > since.getTime()),
    );
    const now = this.runtime.now();
    if (program?.feedText === "full") {
      return {
        posts: fresh.map((item) => feedPost(item, program, now)),
        chosen: [],
        program: program.id,
      };
    }
    // Cut, with an id its items name: partial posts, whole only once the
    // filters keep one (US-476). The feed dates an item by its newest reply,
    // so the window goes with the post for its page to decide.
    if (program && fresh.every((item) => program.feedThreadId?.(item.url))) {
      const partial = since ? { since } : {};
      return {
        posts: fresh.map((item) => feedPost(item, program, now, partial)),
        chosen: [],
        program: program.id,
      };
    }
    // A feed no program claims: the thread's own page is the post.
    const chosen = fresh.slice(0, this.threadsPerSection).map((item) => ({
      url: item.url,
      ...(item.publishedAt ? { startedAt: item.publishedAt.toISOString() } : {}),
      approximate: false,
    }));
    return { posts: [], chosen, program: program?.id ?? null };
  }

  private tell(event: ForumPageEvent): void {
    try {
      this.options.onPage?.(event);
    } catch (error) {
      this.runtime.logger.error({ err: error }, "forum page event handler failed");
    }
  }

  /** Open each thread, keep the ones whose own time is new enough. */
  private async open(
    batch: readonly Pending[],
    request: SearchRequest,
    fetcher: ForumPageFetcher,
  ): Promise<{ posts: CandidatePost[]; units: number }> {
    const posts: CandidatePost[] = [];
    let units = 0;
    for (const pending of batch) {
      const read = await this.readThreadPage(pending, request.query.since, fetcher);
      units += read.unitsConsumed;
      if (read.status === "complete") posts.push(read.post);
    }
    return { posts, units };
  }

  /** One thread's page as its post, unless it started before `since`. */
  private async readThreadPage(
    pending: Pending,
    since: Date | undefined,
    fetcher: ForumPageFetcher,
  ): Promise<CompleteResult> {
    const now = this.runtime.now();
    const fetched = await fetcher.fetch(pending.url);
    const unitsConsumed = fetched.units;
    const { answer, via } = fetched;
    const event = {
      host: hostOf(pending.url),
      url: pending.url,
      page: "thread" as const,
      via,
      units: fetched.units,
    };
    if (!answer.ok) {
      this.runtime.logger.warn(
        { thread: pending.url, via, reason: answer.reason },
        "forum thread skipped: no page came back",
      );
      this.tell({ ...event, outcome: "refused", program: null, reason: answer.reason });
      return { status: "unread", reason: answer.reason, unitsConsumed };
    }
    const program = detectForum(answer.body);
    const thread = program?.readThread(answer.body, pending.url, now);
    if (!thread) {
      this.runtime.logger.warn(
        { thread: pending.url, via, program: program?.id ?? null, page: pageSummary(answer.body) },
        "forum thread skipped: no parser read it",
      );
      this.tell({ ...event, outcome: "unparsed", program: program?.id ?? null });
      return { status: "unread", reason: "no parser read the thread's page", unitsConsumed };
    }
    this.tell({ ...event, outcome: "read", program: program?.id ?? null });
    const startedAt = thread.postedAt ?? (pending.startedAt ? new Date(pending.startedAt) : null);
    const approximate = thread.postedAt
      ? thread.approximatePostedAt
      : pending.approximate || !startedAt;
    const postedAt = startedAt ?? now;
    if (since && postedAt.getTime() <= since.getTime() - (approximate ? wordsMarginMs : 0))
      return {
        status: "old",
        reason: "the thread started before the poll's window",
        unitsConsumed,
      };
    const host = new URL(thread.url).hostname;
    return {
      status: "complete",
      post: {
        // A thread id is only unique inside its forum.
        externalId: `${host}:${thread.id}`,
        url: thread.url,
        channel: host,
        title: thread.title,
        text: thread.text || thread.title,
        postedAt,
        ...(approximate ? { postedAtIsApproximate: true } : {}),
      },
      unitsConsumed,
    };
  }

  /**
   * A partial post from a feed that cuts its text, whole: its thread's page.
   * US-476. One browser at most, stopped before this returns.
   */
  async completePost(request: CompleteRequest): Promise<CompleteResult> {
    const fetcher = openForumFetcher(
      this.runtime,
      request.credentials,
      { ...(this.browser ? { browser: this.browser } : {}), ...this.fetcherFor() },
      request.signal,
    );
    try {
      return await this.readThreadPage(
        { url: request.url, approximate: false },
        request.since,
        fetcher,
      );
    } finally {
      await fetcher.close();
    }
  }
}

const hostOf = (url: string) => new URL(url).hostname;

/**
 * A feed item as a post: the thread's first post, or with `partial` the cut
 * a feed gives of it (US-476).
 */
function feedPost(
  item: FeedItem,
  program: ForumProgram,
  now: Date,
  partial?: CandidatePost["partial"],
): CandidatePost {
  const url = new URL(item.url);
  // A thread id is only unique inside its forum; where the address names no
  // id, the address is the id.
  const id = program.feedThreadId?.(item.url) ?? `${url.pathname}${url.search}`;
  return {
    externalId: `${url.hostname}:${id}`,
    url: item.url,
    channel: url.hostname,
    title: item.title,
    text: item.text || item.title,
    postedAt: item.publishedAt ?? now,
    ...(item.publishedAt ? {} : { postedAtIsApproximate: true }),
    ...(partial ? { partial } : {}),
  };
}

/**
 * One list and the most threads it may open; with the browser, each page may
 * be read twice (a retry) and each call may start a browser.
 */
function maxUnitsFor(threadsPerSection: number, browser: boolean): number {
  const pages = 1 + threadsPerSection;
  return browser ? 2 * pages + 1 + Math.ceil(threadsPerSection / threadsPerCall) : pages;
}

/**
 * The connector, opening at most `threadsPerSection` threads a section a poll.
 * An application whose readers are not paying sets fewer: each is a request.
 */
export function createBrightDataForum(options: ForumOptions = {}): ConnectorDefinition {
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
    maxUnitsPerQueryPoll: maxUnitsFor(threadsPerSection, Boolean(options.browser)),
    create: (runtime) => new BrightDataForumSource(runtime, { ...options, threadsPerSection }),
  };
}

export const brightDataForum: ConnectorDefinition = createBrightDataForum();
