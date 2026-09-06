import { useCallback, useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";
import { BrandIcon } from "./BrandIcon.js";
import { projectSuffix, routeParam } from "./route.js";
import { choiceFor, describeSchedule, scheduleChoices } from "./schedule.js";

/**
 * The monitor list: what each monitor is doing, what it has spent, and what it
 * may still spend.
 *
 * US-013 asks for two things this screen exists to carry. A refused poll must
 * be visible with its reason, because a monitor that quietly stopped
 * collecting looks exactly like a quiet week — and an empty inbox is the one
 * place a person must never learn that from. And the spend must sit next to
 * the monitor it belongs to, because "what is this costing me" is a question
 * about one monitor, not about the deployment.
 *
 * Every figure here says "estimated" beside it. That is not hedging: we
 * multiply the units a connector reported by the price it declares, and the
 * provider's invoice is the authority. docs/costs.md says why in full, and the
 * screen links to it rather than repeating it.
 */

interface Budget {
  monthlyCapMicros: number;
  onExhausted: "pause" | "notify";
}

interface Spend {
  sourceMicros: number;
  modelMicros: number;
  totalMicros: number;
  remainingMicros: number | null;
  exhausted: boolean;
  reason: string | null;
  since: string;
}

interface MissingCredential {
  environmentVariable: string;
}

interface PreFilter {
  enabled: boolean;
  similarityThreshold: number;
  dropped: { keyword: number; embedding: number };
}

/** The verdicts in force on this monitor's matches. US-012. */
interface Feedback {
  good: number;
  notRelevant: number;
}

/** Which provider last collected one platform for this monitor, and when. */
interface LastCollection {
  source: string;
  provider: string;
  at: string;
}

interface Monitor {
  notificationIssues?: string[];
  id: string;
  name: string;
  /**
   * The project this monitor came out of. US-045.
   *
   * Optional as well as nullable, for the reason BUG-008 taught: a browser
   * holds a build for as long as its tab is open and talks to whatever API is
   * deployed, so a field this screen did not show yesterday can simply be
   * absent.
   */
  projectId?: string | null;
  projectName?: string | null;
  sources: string[];
  paused: boolean;
  lastPolledAt: string | null;
  /** When it runs. US-041. */
  pollIntervalSeconds: number;
  pollDays: number[];
  pollTimezone: string;
  lastCollected: LastCollection[];
  missingCredentials: MissingCredential[];
  budget: Budget | null;
  spend: Spend;
  preFilter: PreFilter;
  feedback: Feedback;
}

type LoadState = "loading" | "ready" | "error";

/**
 * A micro-dollar amount as a person reads it.
 *
 * Up to four decimal places, and the server formats the same way for the
 * sentence it sends. Ten Reddit records cost $0.015, and a page that rounded
 * that to two cents could not be reconciled against an invoice.
 */
export function formatMicros(micros: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(micros / 1_000_000);
}

/** What a person typed in dollars, as the micro-dollars the API takes. */
export function toMicros(dollars: string): number | null {
  const amount = Number(dollars);
  if (!Number.isFinite(amount) || amount < 0) return null;

  return Math.round(amount * 1_000_000);
}

/** The month the figures cover, for the line above them. */
function monthLabel(since: string): string {
  return new Date(since).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * What the person thought of this monitor's matches, in one sentence.
 *
 * PLAN.md sets the ratio as the real measure of success, so the sentence says
 * the ratio and not only the counts. A monitor nobody has judged says so
 * rather than showing two zeros, because "0 good" reads as a verdict about the
 * monitor and it is a verdict about nothing.
 */
function feedbackLabel({ good, notRelevant }: Feedback): string {
  const judged = good + notRelevant;
  if (judged === 0) return "No matches judged yet";

  return `${good} good, ${notRelevant} not relevant of ${judged} judged`;
}

/**
 * What this monitor is doing, in two words.
 *
 * The budget comes before the pause, because a monitor the cap paused is
 * paused *for a reason a person needs*, and "Paused" alone would send them
 * looking for a button somebody pressed.
 */
function status(monitor: Monitor): { label: string; tone: string } {
  if (monitor.spend.exhausted) return { label: "Budget spent", tone: "stopped" };
  if (monitor.missingCredentials.length > 0) return { label: "Needs a key", tone: "stopped" };
  if (monitor.paused) return { label: "Paused", tone: "paused" };

  return { label: "Running", tone: "running" };
}

function MonitorsHeader() {
  return (
    <header className="topbar">
      <div>
        <h1>Monitors</h1>
        <p className="page-subtitle">Keep an eye on the conversations that matter.</p>
      </div>
      <a className="top-primary-button" href={`#/monitors/new${projectSuffix()}`}>
        <span aria-hidden="true">+</span> New monitor
      </a>
    </header>
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
    <div className="budget-form">
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
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void save()}
        >
          Save cap
        </button>
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
 * The pre-filter's two settings, and what it has dropped.
 *
 * The counts sit next to the controls on purpose. A threshold nobody can see
 * the effect of is a number somebody guessed, and this is the only screen that
 * can say "it dropped 340 posts" beside the box that decides it. The similarity
 * is shown as the cosine value the database stores, not as a percentage,
 * because that is what a person comparing it against a recorded drop reads.
 */
/**
 * When a monitor runs, and a way to change it. US-041.
 *
 * This was unreachable until now: `poll_interval_seconds` has existed since
 * US-007 and no screen ever wrote to it, so every monitor anybody made polled
 * hourly for ever. It is the largest cost dial in the product — the same query
 * costs $10.80 a month polled hourly and $648 polled every minute — so the
 * hints say what each choice costs in polls rather than leaving a person to
 * work it out.
 */
function ScheduleForm({ monitor, onSaved }: { monitor: Monitor; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = choiceFor(monitor.pollIntervalSeconds, monitor.pollDays);

  async function choose(id: string): Promise<void> {
    const choice = scheduleChoices.find((one) => one.id === id);
    if (!choice) return;

    setBusy(true);
    setError(null);

    try {
      await requestJson(`/api/monitors/${monitor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pollIntervalSeconds: choice.pollIntervalSeconds,
          pollDays: [...choice.pollDays],
        }),
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
      <label className="field">
        <span>Runs</span>
        <select
          aria-label={`How often ${monitor.name} runs`}
          disabled={busy}
          value={current?.id ?? "custom"}
          onChange={(event) => void choose(event.target.value)}
        >
          {current === undefined && (
            /*
              A monitor edited by hand can sit between two choices. The screen
              says what it actually does rather than rounding it to the nearest
              and changing it silently the next time anybody saves.
            */
            <option value="custom">
              {describeSchedule(monitor.pollIntervalSeconds, monitor.pollDays)}
            </option>
          )}
          {scheduleChoices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label} — {choice.hint}
            </option>
          ))}
        </select>
        <small>Days are counted in {monitor.pollTimezone}.</small>
      </label>

      {error && (
        <p className="notice warning" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

function PreFilterForm({ monitor, onSaved }: { monitor: Monitor; onSaved: () => Promise<void> }) {
  const [threshold, setThreshold] = useState(String(monitor.preFilter.similarityThreshold));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(preFilter: Partial<PreFilter>): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      await requestJson(`/api/monitors/${monitor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preFilter }),
      });
      await onSaved();
    } catch (cause) {
      setError(messageFor(cause, "The pre-filter could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  function saveThreshold(): void {
    const similarityThreshold = Number(threshold);

    if (
      !Number.isFinite(similarityThreshold) ||
      similarityThreshold < 0 ||
      similarityThreshold > 1
    ) {
      setError("Type the similarity as a number between 0 and 1, such as 0.15.");
      return;
    }

    void save({ similarityThreshold });
  }

  return (
    <div className="budget-form">
      <label className="budget-field">
        <span className="budget-label">Similarity needed</span>
        <input
          aria-label={`Similarity needed for ${monitor.name}`}
          inputMode="decimal"
          value={threshold}
          disabled={!monitor.preFilter.enabled}
          onChange={(event) => setThreshold(event.target.value)}
        />
      </label>

      <div className="budget-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !monitor.preFilter.enabled}
          onClick={saveThreshold}
        >
          Save threshold
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => void save({ enabled: !monitor.preFilter.enabled })}
        >
          {monitor.preFilter.enabled ? "Turn the pre-filter off" : "Turn the pre-filter on"}
        </button>
      </div>

      <p className="monitor-filter-counts">
        {monitor.preFilter.enabled
          ? `Kept from the model so far: ${monitor.preFilter.dropped.keyword} on words, ` +
            `${monitor.preFilter.dropped.embedding} on similarity. Every post reaching the ` +
            "model is classified, and every classification is billed."
          : "The pre-filter is off. Every collected post is sent to the model and billed."}
      </p>

      {error && (
        <p className="budget-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Monitors() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const [pending, setPending] = useState<string[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  /**
   * The project this list is scoped to, from `#/monitors?project=<id>`.
   *
   * Filtered here rather than on the server: the list is small, the response
   * already carries the project on every row, and a query parameter would be a
   * second place for the same rule to live.
   */
  const [projectId, setProjectId] = useState(() => routeParam("project"));

  useEffect(() => {
    const onChange = () => setProjectId(routeParam("project"));
    globalThis.addEventListener("hashchange", onChange);
    return () => globalThis.removeEventListener("hashchange", onChange);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      setMonitors(await requestJson<Monitor[]>("/api/monitors"));
      setError(null);
      setState("ready");
    } catch (cause) {
      setError(messageFor(cause, "The monitors could not be loaded."));
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setPaused(monitor: Monitor, paused: boolean): Promise<void> {
    setPending((ids) => [...ids, monitor.id]);
    setError(null);
    try {
      await requestJson(`/api/monitors/${monitor.id}/${paused ? "pause" : "resume"}`, {
        method: "POST",
      });
      await load();
    } catch (cause) {
      // The server's own sentence, because a resume that is refused names the
      // variable that has to be set, and "request failed" names nothing.
      setError(messageFor(cause, "That monitor could not be changed."));
    } finally {
      setPending((ids) => ids.filter((id) => id !== monitor.id));
    }
  }

  if (state === "loading") {
    return (
      <div className="product-page monitors-page">
        <MonitorsHeader />
        <div className="center-state page-state">
          <div className="spinner" aria-hidden="true" />
          <p>Reading your monitors.</p>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="product-page monitors-page">
        <MonitorsHeader />
        <div className="center-state page-state">
          <h2>The monitors could not be loaded</h2>
          <p>{error}</p>
          <button type="button" className="primary-button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (monitors.length === 0) {
    return (
      <div className="product-page monitors-page">
        <MonitorsHeader />
        <div className="center-state page-state">
          <span className="empty-mark" aria-hidden="true">
            ◎
          </span>
          <h2>No monitors yet</h2>
          <p>Create a monitor and IntentWatch will start collecting conversations.</p>
          <a className="primary-button" href={`#/monitors/new${projectSuffix()}`}>
            Create a monitor
          </a>
        </div>
      </div>
    );
  }

  const scoped =
    projectId === null ? monitors : monitors.filter((monitor) => monitor.projectId === projectId);
  const needsAttention = (monitor: Monitor) =>
    status(monitor).tone === "stopped" || !!monitor.notificationIssues?.length;
  const counts = {
    all: scoped.length,
    running: scoped.filter((monitor) => status(monitor).tone === "running").length,
    paused: scoped.filter((monitor) => status(monitor).tone === "paused").length,
    attention: scoped.filter(needsAttention).length,
  };
  const visible = scoped.filter(
    (monitor) =>
      (view === "all" ||
        (view === "attention" ? needsAttention(monitor) : status(monitor).tone === view)) &&
      [monitor.name, monitor.projectName, ...monitor.sources]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );

  return (
    <div className="product-page monitors-page">
      <MonitorsHeader />
      <div className="monitors-content">
        <div className="monitors-overview">
          <div>
            <h2>
              {counts.running} of {counts.all} active
            </h2>
            <p>
              {counts.attention > 0
                ? `${counts.attention} monitor${counts.attention === 1 ? " needs" : "s need"} attention. Review the issues below.`
                : "Manage your schedules, spending and search quality in one place."}
            </p>
          </div>
          <a className="text-link" href="/api/feedback/export">
            Export feedback as JSON
          </a>
        </div>
        <div className="monitors-toolbar">
          <fieldset className="view-switch" aria-label="Filter monitors by status">
            {(
              [
                ["all", "All"],
                ["running", "Running"],
                ["paused", "Paused"],
                ["attention", "Needs attention"],
              ] as const
            ).map(([id, label]) => (
              <button type="button" key={id} aria-pressed={view === id} onClick={() => setView(id)}>
                {label} <span>{counts[id]}</span>
              </button>
            ))}
          </fieldset>
          <input
            className="monitor-search"
            type="search"
            aria-label="Search monitors"
            placeholder="Search monitors…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {error && (
          <p className="budget-error" role="alert">
            {error}
          </p>
        )}
        <p className="monitors-result-count" role="status">
          Showing {visible.length} of {scoped.length} monitors{projectId ? " in this project" : ""}
        </p>
        {visible.length === 0 && (
          <div className="monitor-empty-results">
            <h2>
              {scoped.length === 0
                ? "No monitors in this project yet"
                : "No monitors match these filters"}
            </h2>
            <p>
              {scoped.length === 0
                ? "Create a monitor to start finding conversations for this project."
                : "Try another name, project or platform, or clear your filters."}
            </p>
            {scoped.length === 0 ? (
              <a className="primary-button" href={`#/monitors/new${projectSuffix()}`}>
                Create a monitor
              </a>
            ) : (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setSearch("");
                  setView("all");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
        {groupsOf(visible).map((group) => (
          <section className="monitor-group" key={group.key}>
            {group.name !== null && (
              <h2 className="monitor-group-heading">
                {group.name}
                <span className="monitor-group-count">
                  {group.monitors.length} monitor{group.monitors.length === 1 ? "" : "s"}
                </span>
              </h2>
            )}
            <MonitorCards
              monitors={group.monitors}
              load={load}
              setPaused={setPaused}
              pending={pending}
            />
          </section>
        ))}
        <p className="monitors-cost-note">
          Spend is estimated; your provider’s invoice is the authority. Amounts include source and
          model calls.
        </p>
      </div>
    </div>
  );
}

/**
 * The monitors of one project, or the ones belonging to none. US-045.
 *
 * Grouped in the order the monitors already arrive in — newest first — so a
 * project's position is its newest monitor's, and the list does not reorder
 * itself when a project is renamed.
 *
 * **A monitor with no project is a group with no heading**, at the end. The
 * alternative is a heading somebody has to read as "the rest", which is a name
 * for a thing they never made. Grouping must not make a monitor harder to
 * find than a flat list did.
 */
interface MonitorGroup {
  key: string;
  name: string | null;
  monitors: Monitor[];
}

export function groupsOf(monitors: Monitor[]): MonitorGroup[] {
  const groups: MonitorGroup[] = [];
  const loose: Monitor[] = [];

  for (const monitor of monitors) {
    const id = monitor.projectId ?? null;
    const name = monitor.projectName ?? null;

    // Both, not either: an id with no name is a project the API did not join,
    // and a heading reading a uuid helps nobody.
    if (id === null || name === null) {
      loose.push(monitor);
      continue;
    }

    const found = groups.find((group) => group.key === id);
    if (found) found.monitors.push(monitor);
    else groups.push({ key: id, name, monitors: [monitor] });
  }

  if (loose.length > 0) groups.push({ key: "none", name: null, monitors: loose });

  return groups;
}

/**
 * The cards for one group.
 *
 * `load` and `setPaused` belong to the page, so they are passed in rather than
 * reached for: this is one list among several on the screen, and a component
 * that closed over the page's state could only ever render one of them.
 */
function MonitorCards({
  monitors,
  load,
  setPaused,
  pending,
}: {
  monitors: Monitor[];
  pending: string[];
  load: () => Promise<void>;
  setPaused: (monitor: Monitor, paused: boolean) => Promise<void>;
}) {
  return (
    <ul className="monitor-list">
      {monitors.map((monitor) => {
        const running = status(monitor);

        return (
          <li key={monitor.id} className="monitor-card">
            <div className="monitor-top">
              <div className="monitor-identity">
                <span className="product-icon" aria-hidden="true">
                  {monitor.name.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <h2>{monitor.name}</h2>
                  <p className="monitor-origin">
                    {monitor.sources.length > 0
                      ? monitor.sources.map((source, index) => (
                          <span key={source}>
                            {index > 0 ? " · " : ""}
                            <span className="brand-label">
                              <BrandIcon brand={source} size={16} />
                              {source}
                            </span>
                          </span>
                        ))
                      : "No source"}
                    {monitor.lastPolledAt
                      ? ` · last polled ${new Date(monitor.lastPolledAt).toLocaleString()}`
                      : " · never polled"}
                  </p>
                </div>
              </div>
              <span className={`monitor-status ${running.tone}`}>{running.label}</span>
            </div>

            {/* The sentence that refused the poll, sent whole by the server,
                  so the screen and the worker's log say the same thing. */}
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
                . <a href="#/connections">Open connections</a>
              </p>
            )}
            <p className="monitor-schedule-summary">
              {describeSchedule(monitor.pollIntervalSeconds, monitor.pollDays)}{" "}
              <span>· {monitor.pollTimezone}</span>
            </p>

            <dl className="monitor-spend">
              <div>
                <dt>Spent in {monthLabel(monitor.spend.since)} (estimated)</dt>
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

            {monitor.notificationIssues?.map((issue) => (
              <p key={issue} className="monitor-stopped" role="alert">
                {issue} <a href={`#/monitors/${monitor.id}/notifications`}>Notification settings</a>
              </p>
            ))}

            <p className="monitor-feedback">{feedbackLabel(monitor.feedback)}</p>

            <details className="disclosure monitor-settings">
              <summary>
                Schedule & settings <span>Budget · filtering · activity</span>
              </summary>
              <div className="monitor-controls">
                <section>
                  <h3>Schedule</h3>
                  <ScheduleForm monitor={monitor} onSaved={load} />
                </section>
                <section>
                  <h3>Monthly budget (USD)</h3>
                  <BudgetForm monitor={monitor} onSaved={load} />
                </section>
                <section>
                  <h3>Pre-filter</h3>
                  <PreFilterForm monitor={monitor} onSaved={load} />
                </section>
                <section>
                  <h3>Last collection</h3>{" "}
                  {/* Who actually collected, which is not always who would collect
                  now: the choice can be changed and this is the record of what
                  ran. Read from the ledger, so the moment is when money was
                  last spent on that pair. US-026. */}
                  {monitor.lastCollected.length > 0 && (
                    <p className="monitor-origin">
                      {monitor.lastCollected
                        .map(
                          (one) =>
                            `${one.source} via ${one.provider}, ${new Date(one.at).toLocaleString()}`,
                        )
                        .join(" · ")}
                    </p>
                  )}
                  {monitor.lastCollected.length === 0 && (
                    <p className="monitor-origin">No collections recorded yet.</p>
                  )}
                </section>
              </div>
            </details>
            <div>
              <div className="monitor-card-actions">
                <a className="text-link" href={`#/monitors/${monitor.id}/notifications`}>
                  Notifications
                </a>
                <a
                  className="text-link"
                  href={`#/${monitor.projectId ? `?project=${encodeURIComponent(monitor.projectId)}` : ""}`}
                >
                  View inbox
                </a>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pending.includes(monitor.id)}
                  onClick={() => void setPaused(monitor, !monitor.paused)}
                >
                  {pending.includes(monitor.id) ? "Updating…" : monitor.paused ? "Resume" : "Pause"}
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
