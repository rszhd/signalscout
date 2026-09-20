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
  feedbackLabel,
  formatMicros,
  type Monitor,
  messageFor,
  monitoringState,
  monthLabel,
  nextPollLabel,
  type PreFilter,
  platformName,
  providerName,
  requestJson,
  status,
  toMicros,
  useMonitorRefresh,
} from "@signalscout/ui";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { MonitorHistory } from "./monitor.js";
import { paths } from "./route.js";
import { ScheduleField } from "./ScheduleField.js";
import { describeSchedule } from "./schedule.js";

type LoadState = "loading" | "ready" | "error";

interface QueryPerformanceRow {
  kind: "query" | "channel";
  value: string;
  posts: number;
  matches: number;
  bestScore: number | null;
  lastFoundAt: string | null;
  lastMatchedAt: string | null;
}

interface QueryPerformancePage {
  floor: number;
  inputs: QueryPerformanceRow[];
}

interface SearchInput {
  kind: QueryPerformanceRow["kind"];
  value: string;
}

interface LeadGroup {
  value: string;
  label: string;
  source: string | null;
  matches: number;
  averageScore: number;
  bestScore: number;
  strong: number;
}

interface LeadBreakdown {
  floor: number;
  platforms: LeadGroup[];
  channels: LeadGroup[];
  kinds: LeadGroup[];
  intents: LeadGroup[];
}

/** How long a phrase may go without a match before the screen marks it. US-267. */
export const staleAfterDays = 30;

function inputKey(input: SearchInput): string {
  return `${input.kind}:${input.value}`;
}

/** The plan is the source of truth for inputs that have never returned a post. */
function searchInputs(monitor: Monitor): SearchInput[] {
  const inputs: SearchInput[] = [
    ...Object.values(monitor.queries ?? {}).flatMap((queries) =>
      queries.map((value) => ({ kind: "query" as const, value: value.trim() })),
    ),
    ...(monitor.subreddits ?? []).map((value) => ({
      kind: "channel" as const,
      value: value.trim(),
    })),
  ].filter((input) => input.value !== "");

  return [...new Map(inputs.map((input) => [inputKey(input), input])).values()];
}

/**
 * Whether an input has earned its keep lately. US-267.
 *
 * "Never matched" and "no match in thirty days" are the two marks: the first
 * is a phrase that finds posts and no leads, the expensive kind of wrong, and
 * the second is one that used to work. Both are what a person removes. An
 * input with no row has found nothing yet and is not judged.
 */
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
function QueryPerformance({ monitor }: { readonly monitor: Monitor }) {
  const [page, setPage] = useState<QueryPerformancePage | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setPage(await requestJson<QueryPerformancePage>(`/api/monitors/${monitor.id}/queries`));
      setError(null);
      setState("ready");
    } catch (cause) {
      setError(messageFor(cause, "Search performance could not be loaded."));
      setState("error");
    }
  }, [monitor.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const configured = searchInputs(monitor);
  const rows = page?.inputs ?? [];
  const byInput = new Map(rows.map((row) => [inputKey(row), row]));
  // Older monitor payloads did not carry the plan. Keep their measured rows
  // useful instead of turning a deploy across two versions into an empty box.
  const inputs = configured.length > 0 ? configured : rows;

  return (
    <section className="monitor-detail-section query-performance">
      <div className="monitor-section-heading">
        <div>
          <p className="monitor-section-label">Search plan</p>
          <h2 className="monitor-detail-title">What each query finds</h2>
        </div>
        {page && <span className="monitor-section-note">Matches at {page.floor} or above</span>}
      </div>
      <p className="monitor-origin">
        Only posts collected since query tracking began are counted. A phrase that finds posts and
        never a match is paying for every poll.
      </p>

      {state === "loading" && <p className="monitor-origin">Reading search performance.</p>}

      {state === "error" && (
        <p className="budget-error" role="alert">
          {error}{" "}
          <button className="text-button" type="button" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}

      {state === "ready" && inputs.length === 0 && (
        <p className="monitor-origin">No search inputs are configured.</p>
      )}

      {state === "ready" && inputs.length > 0 && (
        <div className="monitor-stats-scroll">
          <table className="monitor-stats-table">
            <thead>
              <tr>
                <th scope="col">Search input</th>
                <th scope="col">Posts</th>
                <th scope="col">Matches</th>
                <th scope="col">Best score</th>
                <th scope="col">Last found</th>
              </tr>
            </thead>
            <tbody>
              {inputs.map((input) => {
                const row = byInput.get(inputKey(input));
                const verdict = inputVerdict(row);
                return (
                  <tr key={inputKey(input)}>
                    <th scope="row">
                      <span className="monitor-stats-value">
                        {input.kind === "channel" ? `r/${input.value}` : input.value}
                      </span>
                      <small className="monitor-stats-kind">
                        {input.kind === "channel" ? "Subreddit" : "Search query"}
                        {!row ? " · Nothing found yet" : ""}
                        {verdict ? (
                          <>
                            {" · "}
                            <span className="monitor-stats-verdict">{verdict}</span>
                          </>
                        ) : null}
                      </small>
                    </th>
                    <td data-label="Posts">{row ? row.posts.toLocaleString() : "—"}</td>
                    <td data-label="Matches">{row ? row.matches.toLocaleString() : "—"}</td>
                    <td data-label="Best score">
                      {row
                        ? row.bestScore === null
                          ? "No match yet"
                          : `${row.bestScore} / 100`
                        : "—"}
                    </td>
                    <td data-label="Last found">
                      {row?.lastFoundAt ? (
                        <time
                          dateTime={row.lastFoundAt}
                          title={new Date(row.lastFoundAt).toLocaleString()}
                        >
                          {ageLabel(row.lastFoundAt)}
                        </time>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type LeadDimension = "platforms" | "channels" | "kinds" | "intents";

const leadDimensions: { id: LeadDimension; label: string; itemLabel: string }[] = [
  { id: "platforms", label: "Platform", itemLabel: "Platform" },
  { id: "channels", label: "Channel", itemLabel: "Channel" },
  { id: "kinds", label: "Posts vs. comments", itemLabel: "Kind" },
  { id: "intents", label: "Intent", itemLabel: "What they were doing" },
];

function leadGroupName(dimension: LeadDimension, row: LeadGroup): string {
  if (dimension === "platforms") return platformName(row.value);
  if (dimension === "channels") return row.source === "reddit" ? `r/${row.value}` : row.value;
  if (dimension === "kinds") {
    if (row.value === "post") return "Posts";
    if (row.value === "reply") return "Replies and comments";
  }
  return row.label;
}

/**
 * Where this monitor's matches come from, one comparison at a time. US-267.
 *
 * Four stacked tables would be longer than the history beside them. The
 * switch keeps the same columns in one place, so a person changes only the
 * dimension they are comparing. The API has ordered every list by matches.
 */
function LeadSources({ monitorId }: { readonly monitorId: string }) {
  const [breakdown, setBreakdown] = useState<LeadBreakdown | null>(null);
  const [dimension, setDimension] = useState<LeadDimension>("platforms");
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setBreakdown(await requestJson<LeadBreakdown>(`/api/monitors/${monitorId}/leads`));
      setError(null);
      setState("ready");
    } catch (cause) {
      setError(messageFor(cause, "Lead sources could not be loaded."));
      setState("error");
    }
  }, [monitorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const definition = leadDimensions.find((item) => item.id === dimension) ?? leadDimensions[0];
  const rows = breakdown?.[dimension] ?? [];
  const hasMatches =
    breakdown !== null && leadDimensions.some((item) => breakdown[item.id].length > 0);

  return (
    <section className="monitor-detail-section lead-sources">
      <div className="monitor-section-heading">
        <div>
          <p className="monitor-section-label">Sources</p>
          <h2 className="monitor-detail-title">Where the leads come from</h2>
        </div>
        {breakdown && (
          <span className="monitor-section-note">Matches at {breakdown.floor} or above</span>
        )}
      </div>
      <p className="monitor-origin">
        Compare where matches come from and how well they score. A strong lead scores 70 or higher.
      </p>

      {state === "loading" && <p className="monitor-origin">Reading lead sources.</p>}

      {state === "error" && (
        <p className="budget-error" role="alert">
          {error}{" "}
          <button className="text-button" type="button" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}

      {state === "ready" && !hasMatches && (
        <p className="monitor-origin">No matches yet. This fills in as the monitor finds leads.</p>
      )}

      {state === "ready" && hasMatches && definition && (
        <>
          <fieldset className="view-switch lead-breakdown-switch">
            <legend className="visually-hidden">Lead breakdown</legend>
            {leadDimensions.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={dimension === item.id}
                onClick={() => setDimension(item.id)}
              >
                {item.label}
              </button>
            ))}
          </fieldset>

          {rows.length === 0 ? (
            <p className="monitor-origin">Nothing to compare here yet.</p>
          ) : (
            <div className="monitor-stats-scroll">
              <table className="monitor-stats-table">
                <thead>
                  <tr>
                    <th scope="col">{definition.itemLabel}</th>
                    <th scope="col">Matches</th>
                    <th scope="col">Average</th>
                    <th scope="col">Best</th>
                    <th scope="col">Strong 70+</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const source =
                      dimension === "platforms"
                        ? row.value
                        : dimension === "channels"
                          ? row.source
                          : null;
                    return (
                      <tr key={`${row.source ?? "all"}:${row.value}`}>
                        <th scope="row">
                          <span className="monitor-stats-value brand-label">
                            {source ? <BrandIcon brand={source} size={16} /> : null}
                            {leadGroupName(dimension, row)}
                          </span>
                          {dimension === "channels" && row.source ? (
                            <small className="monitor-stats-kind">{platformName(row.source)}</small>
                          ) : null}
                        </th>
                        <td data-label="Matches">{row.matches.toLocaleString()}</td>
                        <td data-label="Average">{row.averageScore} / 100</td>
                        <td data-label="Best">{row.bestScore} / 100</td>
                        <td data-label="Strong 70+">{row.strong.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
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
  const { keyword, embedding, triage } = preFilter.dropped;
  const skipped = keyword + embedding + triage;
  const decided = preFilter.read + skipped;

  if (!preFilter.enabled) {
    return "Every post this monitor collects is read by the AI, and every one is billed.";
  }

  if (decided === 0) return "This monitor has not found any posts yet.";
  if (skipped === 0) return `The AI read all ${decided} posts found. Nothing was skipped.`;

  const reasons = [
    keyword > 0 ? `${keyword} did not use your words` : undefined,
    embedding > 0 ? `${embedding} were not about your subject` : undefined,
    triage > 0 ? `${triage} read as someone answering rather than asking` : undefined,
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
        <div className="center-state page-state">
          <div className="spinner" aria-hidden="true" />
          <p>Reading this monitor.</p>
        </div>
      </div>
    );
  }

  if (state === "error" || !monitor) {
    return (
      <div className="product-page monitors-page monitor-page">
        <div className="center-state page-state">
          <h2>This monitor could not be loaded</h2>
          <p>{error}</p>
          <Link className="secondary-button" to={paths.monitors(projectId)}>
            Back to monitors
          </Link>
        </div>
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
          <span className={`monitor-status ${running.tone}${running.attention ? " quiet" : ""}`}>
            {running.label}
          </span>
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

            <LeadSources monitorId={monitor.id} />
            <QueryPerformance monitor={monitor} />

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
                Spend is estimated; your provider’s invoice is the authority. Amounts include source
                and model calls.
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

            <section className="monitor-detail-section collection-settings-section">
              <div className="monitor-section-heading">
                <div>
                  <p className="monitor-section-label">History</p>
                  <h2 className="monitor-detail-title">Recent activity</h2>
                </div>
                <span className="monitor-section-note">Newest first</span>
              </div>
              <MonitorHistory monitorId={monitor.id} working={monitoring?.working === true} />
            </section>
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
