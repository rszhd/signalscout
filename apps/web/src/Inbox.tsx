import { useCallback, useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";
import { BrandIcon } from "./BrandIcon.js";

/**
 * The intent inbox.
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

const dismissedFilters = [
  { value: "hide", label: "Hidden" },
  { value: "show", label: "Shown" },
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
  const [judging, setJudging] = useState(false);
  const [saving, setSaving] = useState(false);

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
    if (showDismissed) query.set("includeNotRelevant", "true");
    if (showSaved) query.set("saved", "true");

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
  }, [monitorId, minScore, showDismissed, showSaved]);

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
    if (showDismissed) query.set("includeNotRelevant", "true");
    if (showSaved) query.set("saved", "true");

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
    setShowDismissed(false);
  }

  return (
    <div className="product-page inbox-page">
      <header className="topbar">
        <div>
          <h1>Intent inbox</h1>
          <p className="page-subtitle">Find your next conversation.</p>
        </div>
        {(matches.length > 0 || monitors.length === 0) && (
          <a className="top-secondary-link" href="#/monitors/new">
            <span aria-hidden="true">+ </span>New monitor
          </a>
        )}
      </header>

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
          ) : showSaved ? (
            <>
              <span className="empty-mark" aria-hidden="true">
                ☆
              </span>
              <h2>No saved conversations yet</h2>
              <p>Save a conversation from your inbox to come back to it here.</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowSaved(false)}
              >
                Back to inbox
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

      {state !== "loading" && state !== "error" && matches.length > 0 && selectedMatch && (
        <div className="inbox-layout">
          <div className="match-list-column">
            <div className="list-heading">
              <span>
                {matches.length}
                {page?.nextCursor ? "+" : ""} conversations
              </span>
              <span>{showSaved ? "Recently saved" : "Ranked by score & age"}</span>
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

                <details className="disclosure score-section">
                  <summary>
                    Score breakdown <span>{selectedMatch.score} / 100</span>
                  </summary>

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
                </details>

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

      {error && state === "ready" && (
        <p className="form-error floating-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
