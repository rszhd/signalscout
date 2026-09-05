import { useCallback, useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";

/**
 * The intent inbox.
 *
 * The server owns ranking and filtering. This screen keeps the mockup's
 * compact list-and-detail reading flow while showing only behaviour the
 * application has: filters, pagination and a link to the conversation.
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

const scoreFilters = [
  { value: 0, label: "Any score" },
  { value: 50, label: "50 and above" },
  { value: 70, label: "70 and above" },
  { value: 85, label: "85 and above" },
];

const postPreviewWordLimit = 80;

function limitWords(body: string): { text: string; truncated: boolean } {
  const words = body.trim().split(/\s+/).filter(Boolean);
  if (words.length <= postPreviewWordLimit) return { text: body, truncated: false };

  return {
    text: `${words.slice(0, postPreviewWordLimit).join(" ")}…`,
    truncated: true,
  };
}

function band(score: number): { label: string; tone: string } {
  if (score >= 80) return { label: "High intent", tone: "high" };
  if (score >= 55) return { label: "Worth reading", tone: "medium" };
  return { label: "Low intent", tone: "low" };
}

export function ageLabel(postedAt: string, now: number = Date.now()): string {
  const minutes = Math.round((now - new Date(postedAt).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

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
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    requestJson<MonitorSummary[]>("/api/monitors")
      .then((rows) => {
        if (!cancelled) setMonitors(rows.map(({ id, name }) => ({ id, name })));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const loadFirstPage = useCallback(async (): Promise<void> => {
    setState("loading");
    setError(null);

    const query = new URLSearchParams();
    if (monitorId) query.set("monitorId", monitorId);
    if (minScore > 0) query.set("minScore", String(minScore));

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

  const filtered = monitorId !== "" || minScore > 0;
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? matches[0] ?? null;
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
  }

  return (
    <div className="product-page inbox-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Conversations ranked by buying signal</p>
          <h1>Intent inbox</h1>
        </div>
        {(matches.length > 0 || monitors.length === 0) && (
          <a className="top-primary-button" href="#/monitors/new">
            <span aria-hidden="true">+</span> New monitor
          </a>
        )}
      </header>

      <div className="inbox-toolbar">
        <p>
          {matches.length > 0
            ? "Showing " +
              matches.length +
              " scored conversation" +
              (matches.length === 1 ? "" : "s")
            : "Filter conversations as matches arrive"}
        </p>
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
        <div className="center-state page-state" role="status">
          <span className="spinner" aria-hidden="true" />
          <h2>Loading the inbox</h2>
          <p>Reading the matches your monitors have scored.</p>
        </div>
      )}

      {state === "error" && (
        <div className="center-state page-state error-state" role="alert">
          <span className="state-icon">!</span>
          <h2>The inbox could not be loaded</h2>
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => void loadFirstPage()}>
            Try again
          </button>
        </div>
      )}

      {state !== "loading" && state !== "error" && matches.length === 0 && (
        <div className="center-state page-state" role="status">
          {monitors.length === 0 ? (
            <>
              <span className="empty-mark" aria-hidden="true">
                ✦
              </span>
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
              <span className="empty-mark" aria-hidden="true">
                ✦
              </span>
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

      {matches.length > 0 && selectedMatch && (
        <div className="inbox-layout">
          <div className="match-list-column">
            <div className="inbox-scroll-region">
              <ol className="match-list" aria-label="Matches">
                {matches.map((match) => {
                  const tone = band(match.score);
                  return (
                    <li key={match.id}>
                      <button
                        className={`match-card ${selectedMatch.id === match.id ? "selected" : ""}`}
                        type="button"
                        onClick={() => {
                          setSelectedMatchId(match.id);
                          setMobileDetailOpen(true);
                          setExpandedMatchId(null);
                        }}
                      >
                        <span className="match-top">
                          <span className={`source-badge source-${match.source}`}>
                            <span className="source-dot" aria-hidden="true">
                              {match.source === "x" ? "X" : "r/"}
                            </span>
                            {whereItCameFrom(match)}
                          </span>
                          <span className="match-origin">{ageLabel(match.postedAt)}</span>
                        </span>
                        <strong className="match-title">{match.title ?? match.excerpt}</strong>
                        {match.title && <span className="match-excerpt">{match.excerpt}</span>}
                        <span className="match-bottom">
                          <span className={`intent-pill ${tone.tone}`}>{tone.label}</span>
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
              <div className="detail-inner">
                <button
                  className="mobile-detail-back"
                  type="button"
                  onClick={() => setMobileDetailOpen(false)}
                >
                  ← Back to inbox
                </button>

                <div className="detail-top">
                  <span className={`source-badge source-${selectedMatch.source}`}>
                    <span className="source-dot" aria-hidden="true">
                      {selectedMatch.source === "x" ? "X" : "r/"}
                    </span>
                    {whereItCameFrom(selectedMatch)}
                  </span>
                  <span className="match-origin">{ageLabel(selectedMatch.postedAt)}</span>
                </div>

                <h2 className="detail-title">
                  {selectedMatch.title ?? "A conversation worth reading"}
                </h2>
                <p className="detail-author">
                  {selectedMatch.author ?? "Unknown author"} · matched by{" "}
                  {selectedMatch.monitorName}
                </p>

                <div className="post-body">
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

                <div className="score-section">
                  <div className="score-heading">
                    <h3>Intent signals</h3>
                    <span>Overall score {selectedMatch.score}</span>
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
                </div>

                <div className="match-actions">
                  <a
                    className="primary-button"
                    href={selectedMatch.url}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    Open conversation ↗
                  </a>
                  <span className="match-meta">{selectedMatch.intentLabel}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {error && state === "ready" && (
        <p className="form-error floating-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
