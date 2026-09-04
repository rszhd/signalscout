import { useCallback, useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";

/**
 * The intent inbox.
 *
 * PLAN.md's mockup is the specification, and the part that makes it a product
 * rather than a saved search is the reasons. A person decides in about two
 * seconds whether to open a conversation, and they decide on the claims, not
 * on the number. So the reasons are the largest thing on a card and the
 * sub-scores are the smallest.
 *
 * PLAN.md also lists what this screen must never become: sentiment charts,
 * share of voice, word clouds, competitor analytics. There is nothing here to
 * turn off, which is the point — the list is worth honouring while the screen
 * still looks empty, because a dashboard is what everyone reaches for then.
 *
 * The ordering is the server's rule and this screen only says what it is.
 * `packages/core/src/matches/matches.ts` holds it: score, minus twelve points
 * for every day since the post was written.
 */

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
  source: string;
  channel: string | null;
  author: string | null;
  title: string | null;
  excerpt: string;
  url: string;
  postedAt: string;
}

interface MatchPage {
  matches: Match[];
  nextCursor: string | null;
  asOf: string;
}

interface MonitorSummary {
  id: string;
  name: string;
}

type LoadState = "loading" | "more" | "ready" | "error";

/** The thresholds the filter offers. A person picks a bar, not a number. */
const scoreFilters = [
  { value: 0, label: "Any score" },
  { value: 50, label: "50 and above" },
  { value: 70, label: "70 and above" },
  { value: 85, label: "85 and above" },
];

/**
 * The band printed above the score.
 *
 * A reading aid over the number and never a second threshold: what becomes a
 * match at all is the monitor's own `min_score`, decided when the monitor was
 * created. These three words only say how hard to look at it.
 */
function band(score: number): { label: string; mark: string; tone: string } {
  if (score >= 80) return { label: "High intent", mark: "🔥", tone: "high" };
  if (score >= 55) return { label: "Worth reading", mark: "◆", tone: "medium" };
  return { label: "Low intent", mark: "·", tone: "low" };
}

/** "12 minutes ago", the way the mockup writes it. */
export function ageLabel(postedAt: string, now: number = Date.now()): string {
  const minutes = Math.round((now - new Date(postedAt).getTime()) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "Reddit · r/SaaS" on Reddit, "X · @handle" on X. */
function whereItCameFrom(match: Match): string {
  const source = match.source === "x" ? "X" : "Reddit";
  const channel =
    match.source === "x"
      ? match.author && `@${match.author}`
      : match.channel && `r/${match.channel}`;

  return channel ? `${source} · ${channel}` : source;
}

export function Inbox() {
  const [monitors, setMonitors] = useState<MonitorSummary[]>([]);
  const [monitorId, setMonitorId] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [matches, setMatches] = useState<Match[]>([]);
  const [page, setPage] = useState<{ nextCursor: string | null; asOf: string } | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    requestJson<MonitorSummary[]>("/api/monitors")
      .then((rows) => {
        if (!cancelled) setMonitors(rows.map(({ id, name }) => ({ id, name })));
      })
      // A failed monitor list costs the filter, not the inbox. The matches
      // request below reports its own failure, and reporting this one too
      // would put two alerts on the screen for one outage.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The first page for the current filters, ranked against a fresh clock.
   *
   * Every later page carries that clock back, so a match cannot slip between
   * two pages while somebody reads. The server explains why; this is the half
   * that has to remember it.
   */
  const loadFirstPage = useCallback(async (): Promise<void> => {
    setState("loading");
    setError(null);

    const query = new URLSearchParams();
    if (monitorId) query.set("monitorId", monitorId);
    if (minScore > 0) query.set("minScore", String(minScore));

    try {
      const answer = await requestJson<MatchPage>(`/api/matches?${query}`);
      setMatches(answer.matches);
      setPage({ nextCursor: answer.nextCursor, asOf: answer.asOf });
      setState("ready");
    } catch (cause) {
      setError(messageFor(cause, "The inbox could not be loaded."));
      setState("error");
    }
  }, [monitorId, minScore]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore(): Promise<void> {
    if (!page?.nextCursor) return;

    setState("more");
    setError(null);

    const query = new URLSearchParams({ cursor: page.nextCursor, asOf: page.asOf });
    if (monitorId) query.set("monitorId", monitorId);
    if (minScore > 0) query.set("minScore", String(minScore));

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
   * What an empty list means depends on why it is empty, and the three
   * answers need three different buttons.
   *
   * With no monitors, the only useful action is to make one. With a filter
   * set, the list may be empty because of the filter, so offering to make
   * another monitor answers a question nobody asked — clearing the filter is
   * what shows whether anything is there. With neither, the person is waiting
   * for the worker, and nothing on this screen updates itself, so the useful
   * button is the one that asks again.
   */
  const filtered = monitorId !== "" || minScore > 0;

  function clearFilters(): void {
    setMonitorId("");
    setMinScore(0);
  }

  return (
    <div className="inbox-page">
      <div className="inbox-heading">
        <div>
          <p className="eyebrow">Intent inbox</p>
          <h1>People who might need your product.</h1>
          <p className="intro-copy">
            Sorted by score, minus twelve points for every day since the post was written. A fresh
            conversation is still open; a good one from last week is not.
          </p>
        </div>

        <div className="inbox-filters">
          <label className="filter">
            <span>Monitor</span>
            <select
              aria-label="Monitor"
              value={monitorId}
              onChange={(event) => setMonitorId(event.target.value)}
            >
              <option value="">Every monitor</option>
              {monitors.map((monitor) => (
                <option key={monitor.id} value={monitor.id}>
                  {monitor.name}
                </option>
              ))}
            </select>
          </label>

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
        </div>
      </div>

      {state === "loading" && (
        <div className="center-state" role="status">
          <span className="spinner" aria-hidden="true" />
          <h2>Loading the inbox</h2>
          <p>Reading the matches your monitors have scored.</p>
        </div>
      )}

      {state === "error" && (
        <div className="center-state error-state" role="alert">
          <span className="state-icon">!</span>
          <h2>The inbox could not be loaded</h2>
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => void loadFirstPage()}>
            Try again
          </button>
        </div>
      )}

      {state !== "loading" && state !== "error" && matches.length === 0 && (
        <div className="center-state" role="status">
          {monitors.length === 0 ? (
            <>
              <h2>No monitors yet</h2>
              <p>Create a monitor and IntentWatch will start collecting conversations.</p>
              <a className="primary-button" href="#/monitors/new">
                Create a monitor
              </a>
            </>
          ) : filtered ? (
            <>
              <h2>No matches with these filters</h2>
              <p>There may be matches the monitor or the minimum score is hiding.</p>
              <button className="secondary-button" type="button" onClick={clearFilters}>
                Clear filters
              </button>
            </>
          ) : (
            <>
              <h2>Nothing has matched yet</h2>
              <p>
                Your monitors collect on their own schedule. Matches appear here as they are scored.
              </p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void loadFirstPage()}
              >
                Check again
              </button>
            </>
          )}
        </div>
      )}

      {matches.length > 0 && (
        <ol className="match-list" aria-label="Matches">
          {matches.map((match) => {
            const tone = band(match.score);

            return (
              <li className="match-card" key={match.id}>
                <div className="match-top">
                  <p className={`intent-band ${tone.tone}`}>
                    <span aria-hidden="true">{tone.mark}</span>
                    <strong>{match.score}</strong>
                    <span>{tone.label}</span>
                  </p>
                  <p className="match-origin">
                    {whereItCameFrom(match)} · {ageLabel(match.postedAt)}
                  </p>
                </div>

                <blockquote className="match-quote">
                  {match.title && <strong>{match.title}</strong>}
                  <p>{match.excerpt}</p>
                </blockquote>

                <div className="match-why">
                  <p className="section-label">Why it matched</p>
                  <ul>
                    {match.reasons.map((reason) => (
                      <li key={reason}>
                        <span aria-hidden="true">✓</span>
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>

                <dl className="match-scores">
                  <div>
                    <dt>Problem fit</dt>
                    <dd>{match.problemFit}</dd>
                  </div>
                  <div>
                    <dt>ICP fit</dt>
                    <dd>{match.icpFit}</dd>
                  </div>
                  <div>
                    <dt>Intent</dt>
                    <dd>{match.intent}</dd>
                  </div>
                </dl>

                <div className="match-actions">
                  <a
                    className="primary-button"
                    href={match.url}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    Open conversation
                  </a>
                  <span className="match-meta">
                    {match.intentLabel} · {match.monitorName}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {error && state === "ready" && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

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
  );
}
