import {
  ageLabel,
  BrandIcon,
  band,
  FormError,
  type Monitor,
  type Monitoring,
  messageFor,
  monitoringState,
  PageState,
  ReplyDraft,
  requestJson,
  useMonitorRefresh,
} from "@signalscout/ui";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { paths } from "./route.js";

/**
 * What the monitoring is doing, above the matches. US-265.
 *
 * The inbox is the screen a person keeps open, and it was the one screen that
 * said nothing about collection: an empty list read equally as "nobody is
 * talking" and as "this was paused a week ago". The bar answers three
 * questions and stops — what is happening, when the next poll is if the answer
 * is "waiting", and what the last poll did.
 *
 * The latest only. A history belongs on the monitor page, one click away.
 * Every word comes from `monitor.tsx`, so this screen and the monitor screens
 * cannot end up saying two different things about one monitor.
 */
function MonitoringBar({
  state,
  projectId,
}: {
  readonly state: Monitoring;
  readonly projectId: string;
}) {
  return (
    <section className="inbox-monitoring" aria-label="Monitoring">
      <span className={`monitor-status ${state.tone}${state.attention ? " quiet" : ""}`}>
        {state.label}
      </span>
      <p
        className="inbox-monitoring-now"
        title={state.nowAt ? new Date(state.nowAt).toLocaleString() : undefined}
      >
        {state.now}
      </p>
      {state.last && state.lastAt && (
        <p className="inbox-monitoring-last">
          <time dateTime={state.lastAt} title={new Date(state.lastAt).toLocaleString()}>
            {ageLabel(state.lastAt)}
          </time>
          {` · ${state.last}`}
        </p>
      )}
      <Link className="inbox-monitor-link" to={paths.monitor(projectId, state.monitor.id)}>
        View monitor
      </Link>
    </section>
  );
}

/**
 * The inbox.
 *
 * The server owns ranking and filtering. This screen keeps the mockup's
 * compact list-and-detail reading flow while showing only behaviour the
 * application has: filters, pagination, a link to the conversation, and the
 * two buttons US-012 asks for.
 *
 * Marking a match not relevant removes it from this list here, in the browser,
 * rather than by reloading the page. The rank depends on a clock, so a reload
 * would move every other row while somebody is reading — and the row they just
 * dismissed is the only one that changed.
 */

/**
 * How often the screen asks whether anything arrived. US-125.
 *
 * Far below the fastest schedule a monitor can have, which is once an hour.
 * That is deliberate and it is not a measurement: being early costs one
 * counting query, and being late costs a person their attention on a screen
 * that is quietly out of date.
 */
const arrivalCheckMs = 60_000;

type Verdict = "good" | "not_relevant";

interface Match {
  id: string;
  monitorId: string;
  monitorName: string;
  score: number;
  problemFit: number;
  icpFit: number;
  intent: number;
  intentLabel: string;
  reasons: string[];
  /** Null when this person has not judged the match yet. */
  verdict: Verdict | null;
  source: string;
  channel: string | null;
  author: string | null;
  title: string | null;
  excerpt: string;
  /** "post" or "reply". US-020. */
  kind: string;
  /** The thread above a reply. Null on a post, and on an orphaned reply. */
  parentTitle: string | null;
  parentExcerpt: string | null;
  parentUrl: string | null;
  /**
   * How deep the thread above a reply was read, and why it stopped. US-048.
   *
   * Optional rather than nullable, and that is the honest type rather than a
   * hedge: a browser holding this build can be talking to an API that predates
   * it, and then these keys are simply absent. Marking them optional makes the
   * compiler ask about that at every use site, which is what would have caught
   * the crash this shape caused.
   */
  parentRepliesRead?: number | null;
  parentReplyCount?: number | null;
  parentRepliesStopped?: string | null;
  /** Kept for later. US-043. Not a verdict; a person's intention. */
  saved: boolean;
  url: string;
  postedAt: string;
}

interface MatchPage {
  matches: Match[];
  nextCursor: string | null;
  asOf: string;
}

/**
 * What this screen reads off a monitor row. A `Monitor` is one, and so is
 * the older, thinner row `thresholdSentence`'s tests hand in.
 */
interface MonitorSummary {
  id: string;
  name: string;
  /** Optional, for BUG-009's reason: an older API does not send it. US-045. */
  projectId?: string | null;
  /** Null until the first poll. Optional for the same reason. */
  lastPolledAt?: string | null;
  /** The score a post must reach to become a match. US-264. Optional, as above. */
  minScore?: number;
}

/**
 * Why an inbox that has been polled is still empty, or null. US-264.
 *
 * An empty inbox has two readings: nobody is talking, or nothing cleared the
 * monitor's minimum score. The second was invisible, and the person cannot
 * tell the two apart without the number. It is named only once a monitor has
 * polled, because before that the answer is simply "not yet".
 */
export function thresholdSentence(monitors: readonly MonitorSummary[]): string | null {
  const polled = monitors.filter((row) => row.lastPolledAt && row.minScore !== undefined);
  if (polled.length === 0) return null;

  const scores = [...new Set(polled.map((row) => row.minScore as number))].sort((a, b) => a - b);
  const floor =
    scores.length === 1
      ? `${scores[0]}`
      : `its monitor's minimum score (${scores[0]} to ${scores[scores.length - 1]})`;

  return `Only a post that scores ${floor} or more becomes a match. If you think that is hiding leads, lower the minimum score on the monitor page.`;
}

type LoadState = "loading" | "more" | "ready" | "error";

const scoreFilters = [
  { value: 0, label: "Any score" },
  { value: 50, label: "50 and above" },
  { value: 70, label: "70 and above" },
  { value: 85, label: "85 and above" },
];

const dismissedFilters = [
  { value: "hide", label: "Hidden" },
  { value: "show", label: "Shown" },
];

/**
 * The orders the list offers, and what the heading calls each one. US-114.
 *
 * An order is not a filter, so it sits beside the monitor picker rather than
 * inside the Filters panel and never adds to that panel's count. A filter says
 * what is on the list; this says where to start reading.
 */
const orders = [
  // "Best" on the control and the rule in the heading below it. The picker has
  // room for one word and the heading has room for the sentence that says what
  // the word means, so neither has to do the other's job.
  { value: "rank", label: "Best", heading: "Ranked by score & age" },
  { value: "score", label: "Score", heading: "Highest score first" },
  { value: "newest", label: "Newest", heading: "Newest first" },
] as const;

type Order = (typeof orders)[number]["value"];

const postPreviewWordLimit = 80;

function limitWords(body: string): { text: string; truncated: boolean } {
  const words = body.trim().split(/\s+/).filter(Boolean);
  if (words.length <= postPreviewWordLimit) return { text: body, truncated: false };

  return {
    text: `${words.slice(0, postPreviewWordLimit).join(" ")}…`,
    truncated: true,
  };
}

/**
 * How each platform names itself, and how it names the place a post came from.
 *
 * A table rather than a branch, because a branch answers "not X, so Reddit"
 * and that is wrong the moment a third platform exists. US-028 added LinkedIn
 * and found exactly that: every LinkedIn match would have been labelled
 * Reddit. A platform missing from here falls back to its own id, which is
 * plain rather than wrong.
 *
 * BrandIcon supplies the decorative platform image; the adjacent text names it.
 */
const platformLabels: Record<
  string,
  {
    name: string;
    where: (match: Match) => string | undefined;
    /**
     * Whether this platform's own link opens the comment, or only the thread.
     *
     * A per-platform fact rather than a per-match one, and it decides what the
     * button may promise. Every platform here currently reaches the comment,
     * and each does it with a format that platform produces itself — YouTube's
     * `&lc=` from its Share button, TikTok's `?cid=` from its comment
     * notification.
     *
     * The field exists because that was not always true and may not stay true.
     * TikTok's connector invented `?comment_id=`, which looked like a deep link
     * and opened the video; for one afternoon this read "thread" and the screen
     * told a person to scroll. An unknown platform defaults to "thread" for the
     * same reason: a button that over-promises sends somebody looking for
     * something that was never there.
     */
    commentLink: "comment" | "thread";
  }
> = {
  reddit: {
    name: "Reddit",
    where: (match) => (match.channel ? `r/${match.channel}` : undefined),
    commentLink: "comment",
  },
  x: {
    name: "X",
    where: (match) => (match.author ? `@${match.author}` : undefined),
    commentLink: "comment",
  },
  linkedin: {
    name: "LinkedIn",
    // On LinkedIn the author is the context, as on X. The stored author is the
    // profile slug out of the post URL, which is what identifies the account.
    where: (match) => (match.author ? `@${match.author}` : undefined),
    commentLink: "comment",
  },
  youtube: {
    name: "YouTube",
    where: (match) => (match.channel ? match.channel : undefined),
    commentLink: "comment",
  },
  tiktok: {
    name: "TikTok",
    // The creator, which is what a TikTok URL is keyed by and the only context
    // a video carries: there is no title and no description, only a caption.
    where: (match) => (match.author ? `@${match.author}` : undefined),
    // `?cid=`, which is the link TikTok puts in a comment notification. It read
    // "thread" for one afternoon on 2026-09-06, while the only known link was
    // one this product had invented and the owner had found it did nothing.
    commentLink: "comment",
  },
};

/**
 * How much of a thread was read, in a sentence, or nothing.
 *
 * US-048. A comment reaches the inbox as a sample of a conversation: threads
 * are read fifty comments at a time and abandoned when a batch holds no
 * lead. How big that sample was, against how big the thread is,
 * changes what it means — and a person cannot guess any of it.
 *
 * The reason for stopping is the half nobody could infer. "We read 100 of
 * 1,713 and stopped because two batches held nothing" and "we read 100 of
 * 1,713 and ran out of budget" look identical on the screen otherwise, and
 * they call for different actions: one is a judgement about the thread, the
 * other is a bill.
 *
 * Nothing is said while a thread is still being read, because a number that
 * moves on its own invites a person to read meaning into it.
 */
function threadDepth(match: Match): string | undefined {
  if (match.kind !== "reply") return undefined;

  /**
   * `== null`, not `=== null`, and the difference crashed the screen.
   *
   * The type says `number | null` and the runtime can still hand back
   * `undefined`: a browser holding this build against an API that predates it
   * receives a row with the field absent, `undefined` slips past a `=== null`
   * check, and `.toLocaleString()` throws — taking the whole inbox down rather
   * than one line of it. A field this component did not exist to show
   * yesterday must be treated as optional whatever the type says.
   */
  const read = match.parentRepliesRead;
  if (read == null || read === 0) return undefined;

  const total = match.parentReplyCount;
  const of = total != null && total > read ? ` of ${total.toLocaleString()}` : "";
  const counted = `${read.toLocaleString()}${of} comment${read === 1 ? "" : "s"} read`;

  switch (match.parentRepliesStopped) {
    case "threshold":
      return `${counted}. Stopped: the last batch held no lead.`;
    case "ceiling":
      return `${counted}. Stopped: this is as deep as one thread is read.`;
    case "budget":
      return `${counted}. Stopped: the monitor reached its budget.`;
    case "end":
      return `${counted} — the whole thread.`;
    default:
      // Still being read. A count that moves is worse than no count.
      return undefined;
  }
}

function platformLabel(source: string) {
  return (
    platformLabels[source] ?? {
      name: source,
      where: () => undefined,
      // An unknown platform promises nothing, which is the safe direction: a
      // button that over-promises sends a person scrolling for something that
      // was never there.
      commentLink: "thread" as const,
    }
  );
}

function whereItCameFrom(match: Match): string {
  const platform = platformLabel(match.source);
  const channel = platform.where(match);

  return channel ? `${platform.name} · ${channel}` : platform.name;
}

/**
 * The inbox of one project. US-045, US-076.
 *
 * The project comes from the address — `/projects/<id>` — and reaches this
 * screen as a prop, because the router already read it. Every effect below
 * lists it as a dependency: moving between projects matches the same route and
 * remounts nothing, so a screen that read it once would keep showing the
 * project a person had navigated away from.
 */
export function Inbox({
  projectId,
  matchId: addressed = null,
}: {
  readonly projectId: string;
  /** The item the address names, or null on the plain inbox. US-268. */
  readonly matchId?: string | null;
}) {
  const navigate = useNavigate();
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [monitorId, setMonitorId] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [matches, setMatches] = useState<Match[]>([]);
  const [page, setPage] = useState<{ nextCursor: string | null; asOf: string } | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>("rank");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  /**
   * The saved list. US-043.
   *
   * A view of the same screen rather than a second page, because the card, the
   * reasons and the buttons are all the same — what changes is which matches
   * are in the list and the order they come in. The server does both.
   */
  const [showSaved, setShowSaved] = useState(false);
  /**
   * How many matches arrived since this page was read. US-125.
   *
   * A number and not rows, because the list must not move while somebody is
   * reading it. Zero means the banner is not shown.
   */
  const [arrived, setArrived] = useState(0);
  const [judging, setJudging] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * What the monitoring is doing, derived on every render. US-265.
   *
   * Derived and not held: it is a reading of the rows below and of the clock,
   * and a copy in state would be a second answer that goes stale between
   * renders. `working` decides how often the rows are re-read.
   */
  const monitoring = monitoringState(monitors);
  const working = monitoring?.working === true;

  /**
   * The project's monitors: what the filter offers, and what the bar reads.
   *
   * The whole row rather than the two fields the filter needs, because US-265
   * put the monitoring status on this screen and the status is derived from
   * the pause, the spend, the credentials, the last poll and the stage. One
   * request answers both.
   *
   * Re-read when the project changes rather than once on mount, for the same
   * reason the matches are: moving between projects remounts nothing, and a
   * dropdown left holding another project's monitors offers a filter that
   * empties the inbox for no visible reason.
   */
  const loadMonitors = useCallback(async (): Promise<void> => {
    try {
      const rows = await requestJson<Monitor[]>("/api/monitors");
      const mine = rows.filter((row) => row.projectId === projectId);

      setMonitors(mine);

      // The monitor filter can outlive the project it belonged to. Clearing
      // it is the honest reset: keeping it would show an empty inbox and
      // name no reason.
      setMonitorId((current) =>
        current !== "" && !mine.some((row) => row.id === current) ? "" : current,
      );
    } catch {
      // Silent, and the bar keeps whatever it last knew. A failed read here
      // costs the person nothing they asked for, and an error beside the
      // matches would report the wrong screen as broken.
    }
  }, [projectId]);

  useEffect(() => {
    void loadMonitors();
  }, [loadMonitors]);

  /**
   * Keep the bar current, on the one rule the monitor screens share. US-265.
   *
   * It is also what moves "Next poll in 2 hours" along without the person
   * reloading: the phrase is rendered from a clock that only ticks when this
   * re-renders.
   */
  useMonitorRefresh(loadMonitors, working);

  /**
   * The filters, as the server takes them.
   *
   * One function rather than a query built where it is needed, because US-064
   * added a second caller: the export must ask for the list on screen, and a
   * button that quietly exported everything would be worse than no button —
   * the person would not check. Two copies of this would drift the first time
   * a filter is added.
   */
  const filterQuery = useCallback((): URLSearchParams => {
    const query = new URLSearchParams();
    query.set("projectId", projectId);
    if (monitorId) query.set("monitorId", monitorId);
    if (minScore > 0) query.set("minScore", String(minScore));
    if (showDismissed) query.set("includeNotRelevant", "true");
    if (showSaved) query.set("saved", "true");
    // Not on the saved list, which has an order of its own. Sending it would
    // ask the server for something it is right to ignore. US-114.
    if (!showSaved && order !== "rank") query.set("order", order);
    return query;
  }, [projectId, monitorId, minScore, showDismissed, showSaved, order]);

  const loadFirstPage = useCallback(async (): Promise<void> => {
    setState("loading");
    setError(null);
    // Whatever had arrived is about to be on screen. This is also what clears
    // the banner when it is clicked, and when a filter changes underneath it.
    setArrived(0);

    const query = filterQuery();

    try {
      const answer = await requestJson<MatchPage>(`/api/matches?${query}`);
      setMatches(answer.matches);
      setSelectedMatchId(answer.matches[0]?.id ?? null);
      setMobileDetailOpen(false);
      setExpandedMatchId(null);
      setPage({ nextCursor: answer.nextCursor, asOf: answer.asOf });
      setState("ready");
    } catch (cause) {
      setError(messageFor(cause, "The inbox could not be loaded."));
      setState("error");
    }
  }, [filterQuery]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  /**
   * Ask how many matches arrived, on a timer. US-125.
   *
   * A number on a timer, and never the list on a timer. The rank depends on a
   * clock, so re-reading the list here would move every row while somebody is
   * reading one — the same reason a dismissed match is removed in the browser
   * rather than by reloading. The banner lets the person say when.
   *
   * `page.asOf` is the instant the list on screen was read, which is exactly
   * what "since" has to mean. Nothing is asked while the tab is hidden: a
   * laptop left open for a week would otherwise send ten thousand requests
   * about a screen nobody is looking at.
   */
  useEffect(() => {
    const since = page?.asOf;

    if (!since) return;

    let cancelled = false;

    const ask = async (): Promise<void> => {
      if (document.visibilityState !== "visible") return;

      // The list's own filters, minus the order, which a count has no use for.
      // A banner counting matches the filters hide would promise leads that
      // are not there when somebody clicks it.
      const query = filterQuery();
      query.delete("order");
      query.set("since", since);

      try {
        const answer = await requestJson<{ count: number }>(`/api/matches/count?${query}`);

        if (!cancelled) setArrived(answer.count);
      } catch {
        // Silent on purpose. The list on screen is still correct, and this is
        // a question the person did not ask; an error here would report a
        // failure that costs them nothing.
      }
    };

    const timer = window.setInterval(() => void ask(), arrivalCheckMs);
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") void ask();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [page?.asOf, filterQuery]);

  async function loadMore(): Promise<void> {
    if (!page?.nextCursor) return;
    setState("more");
    setError(null);

    // The same filters as the first page, plus the paging. Built from the one
    // function rather than copied: a cursor is issued in one order and must be
    // spent in the same one, so a second copy that forgot the order would page
    // a ranked list with a date cursor and drop rows nobody sees go missing.
    const query = filterQuery();
    query.set("cursor", page.nextCursor);
    query.set("asOf", page.asOf);

    try {
      const answer = await requestJson<MatchPage>(`/api/matches?${query}`);
      setMatches((current) => [...current, ...answer.matches]);
      setPage({ nextCursor: answer.nextCursor, asOf: answer.asOf });
      setState("ready");
    } catch (cause) {
      setError(messageFor(cause, "The next page could not be loaded."));
      setState("ready");
    }
  }

  /**
   * Give a verdict, and keep the list honest about it.
   *
   * A dismissed match leaves the list unless the person is looking at the
   * dismissed ones, in which case it stays and the button reads as pressed —
   * that is what makes a dismissal undoable. Nothing is removed until the
   * server has stored the verdict: a row that vanished from a failed request
   * would look like a verdict that was kept.
   */
  /**
   * Keep a match, or let it go. US-043.
   *
   * The row is not removed either way, unlike a "not relevant" verdict. Saving
   * is not a judgement about the match; it is somebody saying they will come
   * back to it, and taking it off the screen when they say so would be the
   * opposite of helpful.
   */
  async function keep(match: Match, saved: boolean): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      await requestJson(`/api/matches/${match.id}/saved`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ saved }),
      });
    } catch (cause) {
      setError(messageFor(cause, "The match could not be saved."));
      return;
    } finally {
      setSaving(false);
    }

    setMatches((current) => current.map((row) => (row.id === match.id ? { ...row, saved } : row)));
  }

  async function judge(match: Match, verdict: Verdict): Promise<void> {
    setJudging(true);
    setError(null);

    try {
      await requestJson(`/api/matches/${match.id}/verdict`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verdict }),
      });
    } catch (cause) {
      setError(messageFor(cause, "The verdict could not be saved."));
      return;
    } finally {
      setJudging(false);
    }

    if (verdict === "not_relevant" && !showDismissed) {
      setMatches((current) => {
        const index = current.findIndex((row) => row.id === match.id);
        const remaining = current.filter((row) => row.id !== match.id);
        // The next match down, or the last one when this was the bottom of
        // the list. Selecting nothing would send a reader back to the top.
        setSelectedMatchId(remaining[index]?.id ?? remaining.at(-1)?.id ?? null);
        return remaining;
      });
      setExpandedMatchId(null);
      return;
    }

    setMatches((current) =>
      current.map((row) => (row.id === match.id ? { ...row, verdict } : row)),
    );
  }

  const filtered = monitorId !== "" || minScore > 0 || showDismissed;
  const orderHeading =
    orders.find((option) => option.value === order)?.heading ?? orders[0].heading;
  /**
   * The item the address names, when the loaded page does not hold it. US-268.
   *
   * A link is sent to somebody whose inbox is not the sender's: a different
   * filter, a later page, or an item they have already dismissed. The list
   * resolves a selection against what it has loaded, so without this the
   * address would quietly open whatever is at the top — the failure US-076
   * removed from the router and would have reintroduced here.
   *
   * It is fetched rather than searched for, and only when the page does not
   * already answer. A 404 leaves it null and the inbox says so.
   */
  const [addressedMatch, setAddressedMatch] = useState<Match | null>(null);
  const [addressMissing, setAddressMissing] = useState(false);

  useEffect(() => {
    if (!addressed) {
      setAddressedMatch(null);
      setAddressMissing(false);
      return;
    }

    // The address asserts the selection after every load, not only on the
    // first: `loadFirstPage` sets the top row, and it resolves after this
    // effect ran on mount. Re-asserting is why `matches` is a dependency.
    setSelectedMatchId(addressed);

    // Nothing is missing until the list has answered. On mount `matches` is
    // empty, and a fetch decided there asks the server for an item the page
    // was about to contain — one wasted request on every link that works.
    if (state === "loading") return;

    if (matches.some((match) => match.id === addressed)) {
      setAddressedMatch(null);
      setAddressMissing(false);
      return;
    }

    let current = true;
    requestJson<Match>(`/api/matches/${addressed}`)
      .then((match) => {
        if (!current) return;
        setAddressedMatch(match);
        setAddressMissing(false);
      })
      .catch(() => {
        if (!current) return;
        setAddressedMatch(null);
        setAddressMissing(true);
      });

    return () => {
      current = false;
    };
  }, [addressed, matches, state]);

  /** Whether the address was copied a moment ago, for the button's own word. */
  const [copied, setCopied] = useState(false);

  async function copyLink(match: Match): Promise<void> {
    const address = `${window.location.origin}${paths.inboxMatch(projectId, match.id)}`;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard: the address is already in the bar, and the person can
      // copy it from there. Nothing to report.
    }
  }

  const selectedMatch =
    matches.find((match) => match.id === selectedMatchId) ?? addressedMatch ?? matches[0] ?? null;
  const scoreRows: Array<[string, number]> = selectedMatch
    ? [
        ["Problem fit", selectedMatch.problemFit],
        ["ICP fit", selectedMatch.icpFit],
        ["Intent", selectedMatch.intent],
      ]
    : [];
  const limitedPost = selectedMatch ? limitWords(selectedMatch.excerpt) : null;
  const postIsExpanded = selectedMatch?.id === expandedMatchId;

  function clearFilters(): void {
    setMonitorId("");
    setMinScore(0);
    setShowDismissed(false);
  }

  return (
    <div className="product-page inbox-page">
      {/* No visible title: the navigation names the screen and the bar below
          says what it is doing. The heading stays for a screen reader. US-281. */}
      <h1 className="visually-hidden">Inbox</h1>

      {monitoring && <MonitoringBar state={monitoring} projectId={projectId} />}

      <div className="inbox-toolbar">
        <fieldset className="view-switch inbox-views" aria-label="Which matches">
          <button type="button" aria-pressed={!showSaved} onClick={() => setShowSaved(false)}>
            Inbox
          </button>
          <button type="button" aria-pressed={showSaved} onClick={() => setShowSaved(true)}>
            Saved
          </button>
        </fieldset>
        <div className="inbox-filters">
          <label className="filter">
            <span>Monitor</span>
            <select
              aria-label="Monitor"
              value={monitorId}
              onChange={(event) => setMonitorId(event.target.value)}
            >
              <option value="">All monitors</option>
              {monitors.map((monitor) => (
                <option key={monitor.id} value={monitor.id}>
                  {monitor.name}
                </option>
              ))}
            </select>
          </label>

          {!showSaved && (
            <label className="filter">
              <span>Order</span>
              <select
                aria-label="Order"
                value={order}
                onChange={(event) => setOrder(event.target.value as Order)}
              >
                {orders.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            className={`compact-button filter-toggle ${filtered ? "active" : ""}`}
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="inbox-extra-filters"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            Filters
            {filtered
              ? ` · ${Number(minScore > 0) + Number(showDismissed) + Number(monitorId !== "")}`
              : ""}
          </button>
        </div>
      </div>
      <div className="inbox-extra-filters" id="inbox-extra-filters" hidden={!filtersOpen}>
        <label className="filter">
          <span>Minimum score</span>
          <select
            aria-label="Minimum score"
            value={String(minScore)}
            onChange={(event) => setMinScore(Number(event.target.value))}
          >
            {scoreFilters.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>

        <label className="filter">
          <span>Not relevant</span>
          <select
            aria-label="Not relevant"
            value={showDismissed ? "show" : "hide"}
            onChange={(event) => setShowDismissed(event.target.value === "show")}
          >
            {dismissedFilters.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>

        {filtered && (
          <button className="read-more-button" type="button" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {/*
        The banner, and the only thing that reloads the list. US-125.

        A live region that is present and empty rather than one that appears
        with its message: a region added to the document at the same moment as
        its content is announced by nothing.
      */}
      <div className="inbox-arrived-slot" role="status" aria-live="polite">
        {arrived > 0 && state !== "loading" && (
          <button className="inbox-arrived" type="button" onClick={() => void loadFirstPage()}>
            {arrived === 1 ? "Show 1 new match" : `Show ${arrived} new matches`}
          </button>
        )}
      </div>

      {state === "loading" && (
        <PageState kind="loading" heading="Loading the inbox">
          Reading the matches your monitors have scored.
        </PageState>
      )}

      {state === "error" && (
        <PageState
          kind="error"
          heading="The inbox could not be loaded"
          action={
            <button className="secondary-button" type="button" onClick={() => void loadFirstPage()}>
              Try again
            </button>
          }
        >
          {error}
        </PageState>
      )}

      {addressMissing && (
        <PageState kind="empty" page={false}>
          That item is not in this inbox any more. It may have been removed, or the link may be for
          a different account.
        </PageState>
      )}

      {state !== "loading" &&
        state !== "error" &&
        matches.length === 0 &&
        !addressedMatch &&
        (monitors.length === 0 ? (
          <PageState
            kind="empty"
            mark="✦"
            heading="No monitors yet"
            action={
              <Link className="primary-button" to={paths.newMonitor(projectId)}>
                Create a monitor
              </Link>
            }
          >
            Create a monitor and SignalScout will start collecting conversations.
          </PageState>
        ) : filtered ? (
          <PageState
            kind="empty"
            heading="No matches with these filters"
            action={
              <button className="secondary-button" type="button" onClick={clearFilters}>
                Clear filters
              </button>
            }
          >
            There may be matches the monitor or the minimum score is hiding.
          </PageState>
        ) : showSaved ? (
          <PageState
            kind="empty"
            mark="☆"
            heading="No saved conversations yet"
            action={
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowSaved(false)}
              >
                Back to inbox
              </button>
            }
          >
            Save a conversation from your inbox to come back to it here.
          </PageState>
        ) : (
          <PageState
            kind="empty"
            mark="✦"
            heading="Nothing has matched yet"
            action={
              <button
                className="secondary-button"
                type="button"
                onClick={() => void loadFirstPage()}
              >
                Check again
              </button>
            }
          >
            Your monitors collect on their own schedule. Matches appear here as they are scored.
            {thresholdSentence(monitors) ? ` ${thresholdSentence(monitors)}` : ""}
          </PageState>
        ))}

      {state !== "loading" && state !== "error" && selectedMatch && (
        <div className="inbox-layout">
          <div className="match-list-column">
            <div className="list-heading">
              <span>
                {matches.length}
                {page?.nextCursor ? "+" : ""} conversations
              </span>
              <span>{showSaved ? "Recently saved" : orderHeading}</span>
              {/*
                Beside the count, because the count is what it exports. US-064.
                A plain link rather than a fetch: the browser downloads it, so
                nothing here has to hold a file in memory or invent a filename
                — the server sets both. "CSV" is on the label because somebody
                asking for Excel will otherwise go looking for a second button.
              */}
              <a className="inbox-export" href={`/api/matches/export?${filterQuery()}`} download>
                Export CSV
              </a>
            </div>
            <div className="inbox-scroll-region">
              <ol className="match-list" aria-label="Matches">
                {matches.map((match) => {
                  const tone = band(match.score);
                  return (
                    <li key={match.id}>
                      <button
                        className={`match-card ${selectedMatch.id === match.id ? "selected" : ""}`}
                        aria-current={selectedMatch.id === match.id ? "true" : undefined}
                        type="button"
                        onClick={() => {
                          setSelectedMatchId(match.id);
                          setMobileDetailOpen(true);
                          setExpandedMatchId(null);
                          // The address follows the reading, so what is on
                          // screen is what a copied link opens. Replace, so
                          // Back leaves the inbox rather than walking every
                          // item that was clicked in it. US-268.
                          navigate(paths.inboxMatch(projectId, match.id), { replace: true });
                        }}
                      >
                        <span className="match-top">
                          <span className={`source-badge source-${match.source}`}>
                            <BrandIcon brand={match.source} />
                            {whereItCameFrom(match)}
                          </span>
                          <span className="match-origin">{ageLabel(match.postedAt)}</span>
                        </span>
                        <strong className="match-title">
                          {match.kind === "reply" && (
                            <span className="match-kind">
                              <span className="visually-hidden">A reply: </span>
                              <span aria-hidden="true">↳ </span>
                            </span>
                          )}
                          {match.title ?? match.parentTitle ?? match.excerpt}
                        </strong>
                        {(match.title ?? match.parentTitle) && (
                          <span className="match-excerpt">{match.excerpt}</span>
                        )}
                        <span className="match-bottom">
                          <span className={`intent-pill ${tone.tone}`}>{tone.label}</span>
                          <span className="match-list-status">
                            {match.saved ? "Saved" : match.verdict === "good" ? "Good lead" : ""}
                          </span>
                          <span className="match-score">
                            <strong>{match.score}</strong>
                            <span>/ 100</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              {page?.nextCursor && (
                <div className="inbox-more">
                  <button
                    className="secondary-button"
                    disabled={state === "more"}
                    type="button"
                    onClick={() => void loadMore()}
                  >
                    {state === "more" ? "Loading…" : "Show more"}
                  </button>
                </div>
              )}
            </div>
          </div>

          <aside className={`match-detail ${mobileDetailOpen ? "mobile-open" : ""}`}>
            <div className="inbox-scroll-region">
              <div className="detail-inner" key={selectedMatch.id}>
                <button
                  className="mobile-detail-back"
                  type="button"
                  onClick={() => setMobileDetailOpen(false)}
                >
                  ← Back to inbox
                </button>

                <div className="detail-top">
                  <span className={`source-badge source-${selectedMatch.source}`}>
                    <BrandIcon brand={selectedMatch.source} />
                    {whereItCameFrom(selectedMatch)}
                  </span>
                  <span className="match-origin">{ageLabel(selectedMatch.postedAt)}</span>
                </div>

                <h2 className="detail-title">
                  {selectedMatch.title ??
                    selectedMatch.parentTitle ??
                    "A conversation worth reading"}
                </h2>
                <p className="detail-author">
                  {selectedMatch.author ?? "Unknown author"} · matched by{" "}
                  {selectedMatch.monitorName}
                </p>

                {/*
                  The thread above a reply, shown before it.

                  A person judging a reply must see what the classifier saw:
                  "we hit this too, what did you end up using?" is a good lead
                  or noise depending entirely on the post above it, and an
                  inbox that hid the post would be asking the wrong question.
                */}
                {selectedMatch.kind === "reply" && selectedMatch.parentExcerpt && (
                  <div className="post-body">
                    <p className="section-label">Replying to</p>
                    <blockquote className="post-box thread-post">
                      {selectedMatch.parentTitle && (
                        <strong className="thread-post-title">{selectedMatch.parentTitle}</strong>
                      )}
                      {limitWords(selectedMatch.parentExcerpt).text}
                    </blockquote>
                    {threadDepth(selectedMatch) && (
                      <p className="thread-depth">{threadDepth(selectedMatch)}</p>
                    )}
                  </div>
                )}

                <div className="post-body">
                  {selectedMatch.kind === "reply" && <p className="section-label">The reply</p>}
                  <blockquote className="post-box">
                    {postIsExpanded ? selectedMatch.excerpt : limitedPost?.text}
                  </blockquote>
                  {limitedPost?.truncated && (
                    <button
                      className="read-more-button"
                      type="button"
                      onClick={() => setExpandedMatchId(postIsExpanded ? null : selectedMatch.id)}
                    >
                      {postIsExpanded ? "Show less" : "Read more"}
                    </button>
                  )}
                </div>

                {/*
                  The three sub-scores sit under the post, open.

                  They explain the number the list was ordered by, so they are
                  read while the post is still in view. Behind a disclosure they
                  were a click nobody made.
                */}
                <section className="score-section">
                  <div className="score-heading">
                    <h3>Score breakdown</h3>
                    <span>{selectedMatch.score} / 100</span>
                  </div>

                  <dl className="match-scores">
                    {scoreRows.map(([label, score]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{score}</dd>
                        <span className="score-bar" aria-hidden="true">
                          <i style={{ width: `${score}%` }} />
                        </span>
                      </div>
                    ))}
                  </dl>
                </section>

                {/*
                  What the link can and cannot do, said before it is pressed.

                  On TikTok the comment has no address. The provider returns
                  none, the platform publishes none, and the `?comment_id=` we
                  invented was opened on 2026-09-06 and ignored — the video
                  opens with the comment section closed. Nothing in this
                  product can fix that, so the honest thing is to say it here
                  and hand over the one thing that makes the scrolling shorter:
                  the handle to look for. The text above is the other half,
                  which is why it is shown in full rather than summarised.
                */}
                {selectedMatch.kind === "reply" &&
                  platformLabel(selectedMatch.source).commentLink === "thread" && (
                    <p className="link-caveat">
                      {platformLabel(selectedMatch.source).name} has no link to a single comment.
                      This opens the post — open the comments and look for{" "}
                      <strong>
                        {selectedMatch.author ? `@${selectedMatch.author}` : "the author"}
                      </strong>
                      .
                    </p>
                  )}

                <div className="match-actions">
                  <a
                    className="primary-button"
                    href={selectedMatch.url}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    {selectedMatch.kind === "reply" &&
                    platformLabel(selectedMatch.source).commentLink === "thread"
                      ? "Open the post ↗"
                      : "Open conversation ↗"}
                  </a>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void copyLink(selectedMatch)}
                  >
                    {copied ? "Link copied" : "Copy link"}
                  </button>
                  <button
                    aria-pressed={selectedMatch.saved}
                    className={`secondary-button ${selectedMatch.saved ? "chosen" : ""}`}
                    disabled={saving}
                    type="button"
                    onClick={() => void keep(selectedMatch, !selectedMatch.saved)}
                  >
                    {selectedMatch.saved ? "Saved" : "Save for later"}
                  </button>
                  <span className="match-meta">{selectedMatch.intentLabel}</span>
                </div>

                <div className="match-why">
                  <p className="section-label">What the model saw</p>
                  <ul>
                    {selectedMatch.reasons.map((reason) => (
                      <li key={reason}>
                        <span aria-hidden="true">•</span>
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>

                <ReplyDraft key={selectedMatch.id} matchId={selectedMatch.id} />

                <div className="verdict-actions">
                  <p className="section-label">Was this a good lead?</p>
                  <div className="verdict-buttons">
                    <button
                      aria-pressed={selectedMatch.verdict === "good"}
                      className={`verdict-button ${
                        selectedMatch.verdict === "good" ? "chosen" : ""
                      }`}
                      disabled={judging}
                      type="button"
                      onClick={() => void judge(selectedMatch, "good")}
                    >
                      Good lead
                    </button>
                    <button
                      aria-pressed={selectedMatch.verdict === "not_relevant"}
                      className={`verdict-button ${
                        selectedMatch.verdict === "not_relevant" ? "chosen" : ""
                      }`}
                      disabled={judging}
                      type="button"
                      onClick={() => void judge(selectedMatch, "not_relevant")}
                    >
                      Not relevant
                    </button>
                  </div>
                  <p className="verdict-note">
                    Dismissed a conversation? Bring it back with Filters → Not relevant → Shown.
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {error && state === "ready" && <FormError className="floating-error">{error}</FormError>}
    </div>
  );
}
