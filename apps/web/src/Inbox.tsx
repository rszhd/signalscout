import {
  ArrivedBanner,
  activeFilters,
  FormError,
  InboxFilters,
  type InboxOrder,
  inboxOrders,
  type Match,
  MatchCard,
  MatchDetail,
  MatchListHeading,
  type Monitor,
  MonitoringBar,
  messageFor,
  monitoringState,
  PageState,
  requestJson,
  ShowMore,
  useMonitorRefresh,
  type Verdict,
} from "@signalscout/ui";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { paths } from "./route.js";

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
  const [order, setOrder] = useState<InboxOrder>("rank");
  const [showDismissed, setShowDismissed] = useState(false);
  /** Leave out the matches the person said they replied to. US-396. */
  const [hideReplied, setHideReplied] = useState(false);
  /**
   * The saved list. US-043.
   *
   * A view of the same screen rather than a second page, because the card, the
   * reasons and the buttons are all the same — what changes is which matches
   * are in the list and the order they come in. The server does both.
   */
  const [showSaved, setShowSaved] = useState(false);
  /**
   * The replied list. US-399. A view like the saved one: the matches the
   * person answered, newest reply first.
   */
  const [showReplied, setShowReplied] = useState(false);
  /**
   * How many matches arrived since this page was read. US-125.
   *
   * A number and not rows, because the list must not move while somebody is
   * reading it. Zero means the banner is not shown.
   */
  const [arrived, setArrived] = useState(0);
  const [judging, setJudging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [marking, setMarking] = useState(false);

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
    // Not on the replied list, which it would empty.
    if (hideReplied && !showReplied) query.set("hideReplied", "true");
    if (showSaved) query.set("saved", "true");
    if (showReplied) query.set("replied", "true");
    // Not on the saved or replied list, which have orders of their own.
    // Sending it would ask the server for something it is right to ignore.
    if (!showSaved && !showReplied && order !== "rank") query.set("order", order);
    return query;
  }, [projectId, monitorId, minScore, showDismissed, hideReplied, showSaved, showReplied, order]);

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

  /**
   * Say the person replied to a match, or take it back. US-396.
   *
   * The row stays, like a saved one, unless it no longer belongs on the list
   * on screen — then it leaves the way a dismissed one does, and the next match
   * down is selected.
   */
  async function markReplied(match: Match, replied: boolean): Promise<void> {
    setMarking(true);
    setError(null);

    try {
      await requestJson(`/api/matches/${match.id}/replied`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ replied }),
      });
    } catch (cause) {
      setError(messageFor(cause, "The reply could not be recorded."));
      return;
    } finally {
      setMarking(false);
    }

    // A match leaves the list it no longer belongs on: a replied one when
    // replied matches are hidden, an unmarked one on the replied list.
    if ((replied && hideReplied && !showReplied) || (!replied && showReplied)) {
      setMatches((current) => {
        const index = current.findIndex((row) => row.id === match.id);
        const remaining = current.filter((row) => row.id !== match.id);
        setSelectedMatchId(remaining[index]?.id ?? remaining.at(-1)?.id ?? null);
        return remaining;
      });
      return;
    }

    setMatches((current) =>
      current.map((row) => (row.id === match.id ? { ...row, replied } : row)),
    );
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
      return;
    }

    setMatches((current) =>
      current.map((row) => (row.id === match.id ? { ...row, verdict } : row)),
    );
  }

  const filtered =
    activeFilters({
      monitors,
      monitorId,
      minScore,
      showDismissed,
      hideReplied: hideReplied && !showReplied,
    }) > 0;
  const orderHeading =
    inboxOrders.find((option) => option.value === order)?.heading ?? inboxOrders[0].heading;
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

  const selectedMatch =
    matches.find((match) => match.id === selectedMatchId) ?? addressedMatch ?? matches[0] ?? null;

  function clearFilters(): void {
    setMonitorId("");
    setMinScore(0);
    setShowDismissed(false);
    setHideReplied(false);
  }

  return (
    <div className="product-page inbox-page">
      {/* No visible title: the navigation names the screen and the bar below
          says what it is doing. The heading stays for a screen reader. US-281. */}
      <h1 className="visually-hidden">Inbox</h1>

      {monitoring && (
        <MonitoringBar
          state={monitoring}
          monitorHref={paths.monitor(projectId, monitoring.monitor.id)}
        />
      )}

      <InboxFilters
        saved={showSaved}
        repliedView={showReplied}
        onRepliedView={setShowReplied}
        onSaved={setShowSaved}
        monitors={monitors}
        monitorId={monitorId}
        onMonitor={setMonitorId}
        order={order}
        onOrder={setOrder}
        minScore={minScore}
        onMinScore={setMinScore}
        showDismissed={showDismissed}
        onShowDismissed={setShowDismissed}
        hideReplied={hideReplied}
        onHideReplied={setHideReplied}
        onClear={clearFilters}
      />

      {/* The only thing that reloads the list. US-125. */}
      <ArrivedBanner
        arrived={state === "loading" ? 0 : arrived}
        onShow={() => void loadFirstPage()}
      />

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
            There may be matches these filters are hiding.
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
        ) : showReplied ? (
          <PageState
            kind="empty"
            mark="↩"
            heading="No replies marked yet"
            action={
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowReplied(false)}
              >
                Back to inbox
              </button>
            }
          >
            Mark a conversation as replied after you post, and it appears here.
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
            <MatchListHeading
              count={matches.length}
              more={page?.nextCursor != null}
              heading={
                showSaved ? "Recently saved" : showReplied ? "Recently replied" : orderHeading
              }
              exportHref={`/api/matches/export?${filterQuery()}`}
            />
            <div className="inbox-scroll-region">
              <ol className="match-list" aria-label="Matches">
                {matches.map((match) => (
                  <li key={match.id}>
                    <MatchCard
                      match={match}
                      selected={selectedMatch.id === match.id}
                      onSelect={() => {
                        setSelectedMatchId(match.id);
                        setMobileDetailOpen(true);
                        // The address follows the reading, so what is on
                        // screen is what a copied link opens. Replace, so
                        // Back leaves the inbox rather than walking every
                        // item that was clicked in it. US-268.
                        navigate(paths.inboxMatch(projectId, match.id), { replace: true });
                      }}
                    />
                  </li>
                ))}
              </ol>

              {page?.nextCursor && (
                <ShowMore loading={state === "more"} onClick={() => void loadMore()} />
              )}
            </div>
          </div>

          <aside className={`match-detail ${mobileDetailOpen ? "mobile-open" : ""}`}>
            <div className="inbox-scroll-region">
              <MatchDetail
                key={selectedMatch.id}
                match={selectedMatch}
                saving={saving}
                judging={judging}
                onSave={(saved) => void keep(selectedMatch, saved)}
                onJudge={(verdict) => void judge(selectedMatch, verdict)}
                marking={marking}
                onReplied={(replied) => void markReplied(selectedMatch, replied)}
                onBack={() => setMobileDetailOpen(false)}
              />
            </div>
          </aside>
        </div>
      )}

      {error && state === "ready" && <FormError className="floating-error">{error}</FormError>}
    </div>
  );
}
