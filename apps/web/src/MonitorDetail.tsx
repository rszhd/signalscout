/**
 * One monitor: everything about it, and everything it has done. US-109.
 *
 * The list next door answers *which monitor needs me*; this answers *what
 * about it*. They used to be the same screen, so the settings forms were
 * rendered inside a row of a list and the poll history was fetched lazily to
 * stop thirty rows costing thirty requests. Here there is one monitor, so the
 * history loads with the page.
 *
 * It reads `GET /api/monitors/:id`, which answers 404 for a monitor belonging
 * to another account — the same read the list is scoped by, so a person cannot
 * reach a stranger's monitor by typing its id into the address.
 */

import {
  ageLabel,
  BrandIcon,
  type Budget,
  Button,
  describeSchedule,
  feedbackLabel,
  formatMicros,
  type LeadBreakdown,
  LeadSources,
  type Monitor,
  MonitorStatus,
  messageFor,
  monitoringState,
  monthLabel,
  nextPollLabel,
  PageState,
  type PreFilter,
  platformName,
  providerName,
  QueryPerformance,
  type QueryPerformanceRow,
  requestJson,
  status,
  toMicros,
  useMonitorRefresh,
} from "@signalscout/ui";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { MonitorActivity } from "./monitor.js";
import { paths } from "./route.js";
import { ScheduleField } from "./ScheduleField.js";

type LoadState = "loading" | "ready" | "error";
type MonitorDetailView = "overview" | "history" | "queries" | "leads";

/** What this API adds to the query rows: the floor a match needed. */
interface QueryPerformancePage {
  floor: number;
  inputs: QueryPerformanceRow[];
}

export const staleAfterDays = 30;

export function inputVerdict(
  row: QueryPerformanceRow | undefined,
  now: number = Date.now(),
): string | null {
  if (!row || row.posts === 0) return null;
  if (row.matches === 0 || !row.lastMatchedAt) return "Never matched";
  const age = now - new Date(row.lastMatchedAt).getTime();
  if (age > staleAfterDays * 86_400_000) return `No match in ${staleAfterDays} days`;
  return null;
}

/**
 * What each search input has produced since attribution began. US-267.
 *
 * A missing row is not an error: collection creates the row, so the monitor's
 * plan supplies the input and this screen supplies the empty state. A null
 * best score is different — posts came back, but none became a match.
 *
 * The heading names the floor. Every match count here is at or above the
 * monitor's minimum score, and a statistic nobody can reproduce is worse
 * than no statistic.
 */
function QuerySection({ monitor }: { readonly monitor: Monitor }) {
  const [page, setPage] = useState<QueryPerformancePage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setPage(await requestJson<QueryPerformancePage>(`/api/monitors/${monitor.id}/queries`));
      setError(null);
    } catch (cause) {
      setError(messageFor(cause, "Search performance could not be loaded."));
    }
  }, [monitor.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="monitor-detail-section">
      <div className="monitor-section-heading">
        <div>
          <p className="monitor-section-label">Search plan</p>
          <h2 className="monitor-detail-title">What each query finds</h2>
        </div>
        {page && <span className="monitor-section-note">Matches at {page.floor} or above</span>}
      </div>
      <QueryPerformance
        monitor={monitor}
        rows={page?.inputs ?? null}
        error={error}
        onRetry={() => void load()}
        note={(row) => inputVerdict(row)}
      />
    </section>
  );
}

/**
 * Every group this API sends, posts against comments included: self-hosted
 * the split is a question a person tuning a monitor asks (US-267).
 */
const leadDimensions = ["platforms", "channels", "kinds", "intents"] as const;

function LeadSection({ monitorId }: { readonly monitorId: string }) {
  const [breakdown, setBreakdown] = useState<LeadBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setBreakdown(await requestJson<LeadBreakdown>(`/api/monitors/${monitorId}/leads`));
      setError(null);
    } catch (cause) {
      setError(messageFor(cause, "Lead sources could not be loaded."));
    }
  }, [monitorId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="monitor-detail-section">
      <div className="monitor-section-heading">
        <div>
          <p className="monitor-section-label">Sources</p>
          <h2 className="monitor-detail-title">Where the leads come from</h2>
        </div>
        {breakdown?.floor !== undefined && (
          <span className="monitor-section-note">Matches at {breakdown.floor} or above</span>
        )}
      </div>
      <LeadSources
        breakdown={breakdown}
        error={error}
        onRetry={() => void load()}
        dimensions={leadDimensions}
      />
    </section>
  );
}

function BudgetForm({ monitor, onSaved }: { monitor: Monitor; onSaved: () => Promise<void> }) {
  const [cap, setCap] = useState(
    monitor.budget ? String(monitor.budget.monthlyCapMicros / 1_000_000) : "",
  );
  const [onExhausted, setOnExhausted] = useState<Budget["onExhausted"]>(
    monitor.budget?.onExhausted ?? "pause",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    const monthlyCapMicros = toMicros(cap);

    if (monthlyCapMicros === null) {
      setError("Type the cap as an amount in dollars, such as 5 or 2.50.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await requestJson(`/api/monitors/${monitor.id}/budget`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ monthlyCapMicros, onExhausted }),
      });
      await onSaved();
    } catch (cause) {
      setError(messageFor(cause, "The budget could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      await requestJson(`/api/monitors/${monitor.id}/budget`, { method: "DELETE" });
      setCap("");
      await onSaved();
    } catch (cause) {
      setError(messageFor(cause, "The budget could not be removed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="budget-form budget-settings-form">
      <label className="budget-field">
        <span className="budget-label">Monthly cap</span>
        <input
          aria-label={`Monthly cap for ${monitor.name}`}
          inputMode="decimal"
          placeholder="No cap"
          value={cap}
          onChange={(event) => setCap(event.target.value)}
        />
      </label>

      <label className="budget-field">
        <span className="budget-label">When it is spent</span>
        <select
          aria-label={`When the budget for ${monitor.name} is spent`}
          value={onExhausted}
          onChange={(event) => setOnExhausted(event.target.value as Budget["onExhausted"])}
        >
          {/* Two behaviours, and the difference is what happens next month.
              A paused monitor waits for a person; a notified one starts
              collecting again by itself when the spend resets. */}
          <option value="pause">Pause the monitor</option>
          <option value="notify">Tell me, and stop polling until next month</option>
        </select>
      </label>

      <div className="budget-actions">
        <Button disabled={busy} onClick={() => void save()}>
          Save cap
        </Button>
        {monitor.budget && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void remove()}
          >
            Remove cap
          </button>
        )}
      </div>

      {error && (
        <p className="budget-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The score a post must reach to become a match, and a way to change it.
 * US-264.
 *
 * `min_score` decided what every person saw and no screen showed it, so an
 * empty inbox could not be told apart from an inbox whose floor was too
 * high, and moving the floor meant SQL. The default is the package's 30 and
 * stays there (US-223); this is where a person raises it on their own
 * evidence.
 */
function ThresholdForm({ monitor, onSaved }: { monitor: Monitor; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(String(monitor.minScore ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setError(null);
    const trimmed = value.trim();
    const minScore = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
    if (minScore === null || minScore > 100) {
      setError("Type the minimum score as a whole number from 0 to 100.");
      return;
    }

    setBusy(true);
    try {
      await requestJson(`/api/monitors/${monitor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minScore }),
      });
      await onSaved();
    } catch (cause) {
      setError(messageFor(cause, "The minimum score could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="budget-form budget-settings-form threshold-form">
      <label className="budget-field">
        <span className="budget-label">Minimum score to match</span>
        <input
          aria-label={`Minimum score to match for ${monitor.name}`}
          inputMode="numeric"
          placeholder="30"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>

      <div className="budget-actions">
        <Button disabled={busy} onClick={() => void save()}>
          Save minimum score
        </Button>
      </div>

      {error && (
        <p className="budget-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * When a monitor runs, and a way to change it. US-041.
 *
 * This was unreachable until then: `poll_interval_seconds` has existed since
 * US-007 and no screen ever wrote to it, so every monitor anybody made polled
 * hourly for ever. It is the largest cost dial in the product — the same query
 * costs $10.80 a month polled hourly and $648 polled every minute — so the
 * hints say what each choice costs in polls rather than leaving a person to
 * work it out.
 */
function ScheduleForm({ monitor, onSaved }: { monitor: Monitor; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: { pollIntervalSeconds: number; pollDays: number[] }): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      await requestJson(`/api/monitors/${monitor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      await onSaved();
    } catch (cause) {
      setError(messageFor(cause, "The schedule could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="monitor-schedule">
      <ScheduleField
        pollIntervalSeconds={monitor.pollIntervalSeconds}
        pollDays={monitor.pollDays}
        timezone={monitor.pollTimezone}
        disabled={busy}
        onChange={(next) => void save(next)}
      />

      {error && (
        <p className="notice warning" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * What this monitor has read and what it skipped, in one sentence.
 *
 * Read plus skipped is not a count of anything: `posts` has no monitor column,
 * because one row serves every monitor that found it and the same conversation
 * must not be classified and billed twice. The total is therefore the two
 * numbers the monitor does own, added together — every post it has decided
 * about. A stage that dropped nothing is left out rather than reported as
 * zero, which would invite a question about a stage that did nothing.
 */
export function countsSentence(preFilter: PreFilter): string {
  const { keyword, embedding, triage, ceiling } = preFilter.dropped;
  const skipped = keyword + embedding + triage + ceiling;
  const decided = preFilter.read + skipped;

  if (!preFilter.enabled) {
    // The ceiling is not the filter's, so it holds with the filter off. US-287.
    return ceiling > 0
      ? `Every post this monitor collects is read by the AI, except ${ceiling} past the day's limit for the search that found them.`
      : "Every post this monitor collects is read by the AI, and every one is billed.";
  }

  if (decided === 0) return "This monitor has not found any posts yet.";
  if (skipped === 0) return `The AI read all ${decided} posts found. Nothing was skipped.`;

  const reasons = [
    keyword > 0 ? `${keyword} did not use your words` : undefined,
    embedding > 0 ? `${embedding} were not about your subject` : undefined,
    triage > 0 ? `${triage} read as someone answering rather than asking` : undefined,
    ceiling > 0 ? `${ceiling} were past the day's limit for the search that found them` : undefined,
  ].filter((reason) => reason !== undefined);

  return (
    `The AI read ${preFilter.read} of ${decided} posts found. ` +
    `The other ${skipped} were skipped: ${reasons.join(", ")}.`
  );
}

/**
 * Which posts the AI reads: one choice, in the words the person pays in.
 *
 * This asked for a similarity threshold as a decimal, and a person who does
 * not know what cosine similarity is could not answer it — nor could they see
 * what a wrong answer did, because a threshold set too high deletes leads
 * before anything records them. What is left is the half that is a real
 * decision: money against missed leads.
 *
 * The counts stay, and they are the instrument. A filter dropping most of what
 * it sees is either saving a lot of money or emptying the inbox, and only the
 * number says which question to ask.
 */
function PreFilterForm({ monitor, onSaved }: { monitor: Monitor; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(enabled: boolean): Promise<void> {
    if (enabled === monitor.preFilter.enabled) return;

    setBusy(true);
    setError(null);

    try {
      await requestJson(`/api/monitors/${monitor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preFilter: { enabled } }),
      });
      await onSaved();
    } catch (cause) {
      setError(messageFor(cause, "That could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="reading-choice">
      <fieldset className="reading-options" disabled={busy}>
        <legend className="visually-hidden">Which posts the AI reads</legend>

        <label className="reading-option">
          <input
            className="visually-hidden"
            type="radio"
            name={`reading-${monitor.id}`}
            checked={monitor.preFilter.enabled}
            onChange={() => void save(true)}
          />
          <strong>Only the promising ones</strong>
          <small>Cheaper. A few real leads may be missed.</small>
        </label>

        <label className="reading-option">
          <input
            className="visually-hidden"
            type="radio"
            name={`reading-${monitor.id}`}
            checked={!monitor.preFilter.enabled}
            onChange={() => void save(false)}
          />
          <strong>Every post found</strong>
          <small>Costs more. Misses nothing.</small>
        </label>
      </fieldset>

      <p className="monitor-filter-counts">{countsSentence(monitor.preFilter)}</p>

      {error && (
        <p className="budget-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function MonitorDetail({
  monitorId,
  projectId,
}: {
  readonly monitorId: string;
  readonly projectId: string;
}) {
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Activity is the working view in the hosted app, and it is the reason most
  // people open a monitor. Keep the self-hosted overview available without
  // making it an extra stop before the latest run history. US-270.
  const [detailView, setDetailView] = useState<MonitorDetailView>("history");

  const load = useCallback(async (): Promise<void> => {
    try {
      setMonitor(await requestJson<Monitor>(`/api/monitors/${monitorId}`));
      setError(null);
      setState("ready");
    } catch (cause) {
      setError(messageFor(cause, "This monitor could not be loaded."));
      setState("error");
    }
  }, [monitorId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * What the monitor is doing now, on the rule the inbox bar reads. US-265.
   *
   * The same function, so this page and the inbox cannot say two different
   * things about one monitor at one moment. Null only while nothing is
   * loaded; the screen below is behind the `ready` state.
   */
  const monitoring = monitor ? monitoringState([monitor]) : null;

  // Faster while a stage runs, on the one rule every monitor screen shares.
  useMonitorRefresh(load, monitoring?.working === true);

  async function setPaused(paused: boolean): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      await requestJson(`/api/monitors/${monitorId}/${paused ? "pause" : "resume"}`, {
        method: "POST",
      });
      await load();
    } catch (cause) {
      // The server's own sentence, because a resume that is refused names the
      // variable that has to be set, and "request failed" names nothing.
      setError(messageFor(cause, "That monitor could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="product-page monitors-page monitor-page">
        <PageState kind="loading">Reading this monitor.</PageState>
      </div>
    );
  }

  if (state === "error" || !monitor) {
    return (
      <div className="product-page monitors-page monitor-page">
        <PageState
          kind="error"
          heading="This monitor could not be loaded"
          action={
            <Link className="secondary-button" to={paths.monitors(projectId)}>
              Back to monitors
            </Link>
          }
        >
          {error}
        </PageState>
      </div>
    );
  }

  const running = status(monitor);
  const home = monitor.projectId ?? projectId;

  return (
    <div className="product-page monitors-page monitor-page">
      <header className="topbar">
        <div>
          <p className="monitor-breadcrumb">
            <Link to={paths.monitors(home)}>Monitors</Link>
          </p>
          <h1>{monitor.name}</h1>
          <p className="page-subtitle">
            {monitor.sources.length > 0
              ? monitor.sources.map((source, index) => (
                  <span key={source}>
                    {index > 0 ? " · " : ""}
                    <span className="brand-label">
                      <BrandIcon brand={source} size={16} />
                      {platformName(source)}
                    </span>
                  </span>
                ))
              : "No source"}
          </p>
        </div>
        <div className="monitor-page-actions">
          <MonitorStatus {...running} />
          <Button disabled={busy} onClick={() => void setPaused(!monitor.paused)}>
            {busy ? "Updating…" : monitor.paused ? "Resume" : "Pause"}
          </Button>
        </div>
      </header>

      <div className="monitors-content monitor-controls monitor-page-content">
        <div className="monitor-alerts">
          {error && (
            <p className="budget-error" role="alert">
              {error}
            </p>
          )}

          {/* The sentence that refused the poll, sent whole by the server, so
              the screen and the worker's log say the same thing. */}
          {monitor.spend.reason && (
            <p className="monitor-stopped" role="status">
              {monitor.spend.reason}
            </p>
          )}

          {monitor.missingCredentials.length > 0 && (
            <p className="monitor-stopped">
              Connect a provider to resume collecting. Missing:{" "}
              {monitor.missingCredentials
                .map((credential) => credential.environmentVariable)
                .join(", ")}
              . <Link to={paths.connections}>Open connections</Link>
            </p>
          )}

          {monitor.notificationIssues?.map((issue) => (
            <p key={issue} className="monitor-stopped" role="alert">
              {issue} <Link to={paths.notifications(home, monitor.id)}>Notification settings</Link>
            </p>
          ))}
        </div>

        <section className="monitor-activity" aria-labelledby="monitor-activity-title">
          <div className="monitor-activity-copy">
            <p className="monitor-section-label">Current activity</p>
            {/* The headline is what is happening now — a stage in flight, or
                the wait for the next poll — and never the last poll, which is
                what happened. The last poll is the supporting line. US-265. */}
            <h2
              id="monitor-activity-title"
              className="monitor-activity-title"
              title={monitoring?.nowAt ? new Date(monitoring.nowAt).toLocaleString() : undefined}
            >
              {monitoring?.now ?? "Waiting for the first poll"}
            </h2>
            {monitoring?.last && (
              <p className="monitor-poll-summary monitor-activity-last">{monitoring.last}</p>
            )}
            <p className="monitor-schedule-summary">
              {describeSchedule(monitor.pollIntervalSeconds, monitor.pollDays)}{" "}
              <span className="monitor-schedule-zone">· {monitor.pollTimezone}</span>
              {nextPollLabel(monitor) ? ` · ${nextPollLabel(monitor)}` : ""}
            </p>
          </div>

          <dl className="monitor-key-metrics">
            <div className="monitor-key-metric">
              <dt className="monitor-key-label">Matches found</dt>
              <dd className="monitor-key-value">{monitor.matches ? monitor.matches.total : "—"}</dd>
              <small className="monitor-key-note">
                {monitor.matches ? `${monitor.matches.unread} unread` : "Count unavailable"}
                {monitor.minScore === undefined ? "" : ` · minimum score ${monitor.minScore}`}
              </small>
            </div>
            <div className="monitor-key-metric">
              <dt className="monitor-key-label">Spent this month</dt>
              <dd className="monitor-key-value">{formatMicros(monitor.spend.totalMicros)}</dd>
              <small className="monitor-key-note">Estimated</small>
            </div>
            <div className="monitor-key-metric">
              <dt className="monitor-key-label">Budget left</dt>
              <dd className="monitor-key-value">
                {monitor.spend.remainingMicros === null
                  ? "No cap"
                  : formatMicros(monitor.spend.remainingMicros)}
              </dd>
              <small className="monitor-key-note">{monthLabel(monitor.spend.since)}</small>
            </div>
          </dl>
        </section>

        <div className="monitor-detail-layout">
          <div className="monitor-detail-main">
            <div className="monitor-detail-tabs" role="tablist" aria-label="Monitor details">
              <button
                id="monitor-overview-tab"
                type="button"
                role="tab"
                aria-selected={detailView === "overview"}
                aria-controls="monitor-overview-panel"
                onClick={() => setDetailView("overview")}
              >
                Overview
              </button>
              <button
                id="monitor-history-tab"
                type="button"
                role="tab"
                aria-selected={detailView === "history"}
                aria-controls="monitor-history-panel"
                onClick={() => setDetailView("history")}
              >
                Recent activity
              </button>
              <button
                id="monitor-queries-tab"
                type="button"
                role="tab"
                aria-selected={detailView === "queries"}
                aria-controls="monitor-queries-panel"
                onClick={() => setDetailView("queries")}
              >
                Search performance
              </button>
              <button
                id="monitor-leads-tab"
                type="button"
                role="tab"
                aria-selected={detailView === "leads"}
                aria-controls="monitor-leads-panel"
                onClick={() => setDetailView("leads")}
              >
                Lead sources
              </button>
            </div>

            <div
              id="monitor-overview-panel"
              role="tabpanel"
              aria-labelledby="monitor-overview-tab"
              hidden={detailView !== "overview"}
            >
              <section className="monitor-detail-section monitor-results-section">
                <div className="monitor-section-heading">
                  <div>
                    <p className="monitor-section-label">Results</p>
                    <h2 className="monitor-detail-title">Match quality</h2>
                  </div>
                  <Link className="text-link" to={paths.inbox(home)}>
                    View inbox
                  </Link>
                </div>
                <p className="monitor-found">
                  {monitor.matches
                    ? `${monitor.matches.total} matches found, ${monitor.matches.unread} unread`
                    : "No match count from this server."}
                  {monitor.minScore === undefined ? "" : ` · at ${monitor.minScore} or above`}
                </p>
                <p className="monitor-feedback">{feedbackLabel(monitor.feedback)}</p>
              </section>

              <section className="monitor-detail-section">
                <div className="monitor-section-heading">
                  <div>
                    <p className="monitor-section-label">Cost</p>
                    <h2 className="monitor-detail-title">
                      Spent in {monthLabel(monitor.spend.since)} (estimated)
                    </h2>
                  </div>
                </div>
                <dl className="monitor-spend">
                  <div>
                    <dt>Total</dt>
                    <dd>{formatMicros(monitor.spend.totalMicros)}</dd>
                  </div>
                  <div>
                    <dt>Sources</dt>
                    <dd>{formatMicros(monitor.spend.sourceMicros)}</dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd>{formatMicros(monitor.spend.modelMicros)}</dd>
                  </div>
                  <div>
                    <dt>Left this month</dt>
                    <dd>
                      {monitor.spend.remainingMicros === null
                        ? "No cap set"
                        : formatMicros(monitor.spend.remainingMicros)}
                    </dd>
                  </div>
                </dl>
                <p className="monitors-cost-note">
                  Spend is estimated; your provider’s invoice is the authority. Amounts include
                  source and model calls.
                </p>
              </section>

              <section className="monitor-detail-section collection-settings-section">
                <div className="monitor-section-heading">
                  <div>
                    <p className="monitor-section-label">Sources</p>
                    <h2 className="monitor-detail-title">Last collection</h2>
                  </div>
                </div>
                {/* Who actually collected, which is not always who would collect
                  now: the choice can be changed and this is the record of what
                  ran. Read from the ledger, so the moment is when money was last
                  spent on that pair. US-026. */}
                {monitor.lastCollected.length === 0 ? (
                  <p className="monitor-origin">No collections recorded yet.</p>
                ) : (
                  <ul className="collection-list">
                    {monitor.lastCollected.map((one) => (
                      <li key={`${one.source}-${one.provider}`}>
                        <span className="brand-label">
                          <BrandIcon brand={one.source} size={16} />
                          {platformName(one.source)}
                        </span>
                        <span className="collection-provider">
                          <BrandIcon brand={one.provider} size={14} />
                          {providerName(one.provider)}
                        </span>
                        {/* The exact moment stays in the tooltip. "2 hours ago"
                          answers "did it run this morning?", and the timestamp
                          answers "which row on the invoice?" — two questions, and
                          only the first is asked here. */}
                        <time dateTime={one.at} title={new Date(one.at).toLocaleString()}>
                          {ageLabel(one.at)}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <div
              id="monitor-history-panel"
              role="tabpanel"
              aria-labelledby="monitor-history-tab"
              hidden={detailView !== "history"}
            >
              <section className="monitor-detail-section collection-settings-section">
                <div className="monitor-section-heading monitor-history-heading">
                  <span className="monitor-section-note">Newest first</span>
                </div>
                <MonitorActivity monitorId={monitor.id} working={monitoring?.working === true} />
              </section>
            </div>

            <div
              id="monitor-queries-panel"
              role="tabpanel"
              aria-labelledby="monitor-queries-tab"
              hidden={detailView !== "queries"}
            >
              <QuerySection monitor={monitor} />
            </div>

            <div
              id="monitor-leads-panel"
              role="tabpanel"
              aria-labelledby="monitor-leads-tab"
              hidden={detailView !== "leads"}
            >
              <LeadSection monitorId={monitor.id} />
            </div>
          </div>

          <aside className="monitor-settings-panel" aria-labelledby="monitor-settings-title">
            <div className="monitor-settings-heading">
              <p className="monitor-section-label">Controls</p>
              <h2 id="monitor-settings-title" className="monitor-detail-title">
                Monitor settings
              </h2>
              <p>Schedule and reading changes save when you select them.</p>
            </div>

            <section className="monitor-settings-section">
              <h3>Schedule</h3>
              <ScheduleForm monitor={monitor} onSaved={load} />
            </section>

            <section className="monitor-settings-section">
              <h3>Monthly budget (USD)</h3>
              <BudgetForm monitor={monitor} onSaved={load} />
            </section>

            <section className="monitor-settings-section">
              <h3>Which posts the AI reads</h3>
              <PreFilterForm monitor={monitor} onSaved={load} />
            </section>

            <section className="monitor-settings-section">
              <h3>Which posts become matches</h3>
              <p>
                A post becomes a match when its score reaches this number. A post under it is
                scored, paid for, and never shown. A higher number hides leads before anybody sees
                them.
              </p>
              <ThresholdForm monitor={monitor} onSaved={load} />
            </section>

            <nav className="monitor-card-actions" aria-label="Monitor links">
              <Link className="text-link" to={paths.notifications(home, monitor.id)}>
                Notification settings
              </Link>
              <Link className="text-link" to={paths.inbox(home)}>
                View inbox
              </Link>
            </nav>
          </aside>
        </div>
      </div>
    </div>
  );
}
