import { useCallback, useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";

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

interface Monitor {
  id: string;
  name: string;
  sources: string[];
  paused: boolean;
  lastPolledAt: string | null;
  missingCredentials: MissingCredential[];
  budget: Budget | null;
  spend: Spend;
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

export function Monitors() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setMonitors(await requestJson<Monitor[]>("/api/monitors"));
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
    try {
      await requestJson(`/api/monitors/${monitor.id}/${paused ? "pause" : "resume"}`, {
        method: "POST",
      });
      await load();
    } catch (cause) {
      // The server's own sentence, because a resume that is refused names the
      // variable that has to be set, and "request failed" names nothing.
      setError(messageFor(cause, "That monitor could not be changed."));
    }
  }

  if (state === "loading") {
    return (
      <div className="center-state">
        <div className="spinner" aria-hidden="true" />
        <p>Reading your monitors.</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="center-state">
        <h2>The monitors could not be loaded</h2>
        <p>{error}</p>
        <button type="button" className="primary-button" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  if (monitors.length === 0) {
    return (
      <div className="center-state">
        <h2>No monitors yet</h2>
        <p>Create a monitor and IntentWatch will start collecting conversations.</p>
        <a className="primary-button" href="#/monitors/new">
          Create a monitor
        </a>
      </div>
    );
  }

  return (
    <div className="inbox-page">
      <div className="inbox-heading">
        <div>
          <p className="eyebrow">Monitors</p>
          <h1>What each monitor is collecting, and what it costs</h1>
          <p className="intro-copy">
            Every amount below is an estimate: IntentWatch prices the units each source reports
            against that source's own rate. Your provider's invoice is the authority.
          </p>
        </div>
      </div>

      {error && (
        <p className="budget-error" role="alert">
          {error}
        </p>
      )}

      <ul className="monitor-list">
        {monitors.map((monitor) => {
          const running = status(monitor);

          return (
            <li key={monitor.id} className="monitor-card">
              <div className="monitor-top">
                <div>
                  <h2>{monitor.name}</h2>
                  <p className="monitor-origin">
                    {monitor.sources.length > 0 ? monitor.sources.join(" · ") : "No source"}
                    {monitor.lastPolledAt
                      ? ` · last polled ${new Date(monitor.lastPolledAt).toLocaleString()}`
                      : " · never polled"}
                  </p>
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

              <div className="monitor-controls">
                <BudgetForm monitor={monitor} onSaved={load} />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void setPaused(monitor, !monitor.paused)}
                >
                  {monitor.paused ? "Resume" : "Pause"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
