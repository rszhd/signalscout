/**
 * The monitor list: one row per monitor, and five columns. US-109.
 *
 * A list answers *which one*, and a page answers *what about it*. This was
 * both until US-109, so it was a bad list and a cramped page: a card carried
 * four settings forms, four spend figures and three actions, took about forty
 * lines of vertical space, and three monitors did not fit on one screen. The
 * question the list is opened with — which of these needs me? — was answered
 * by scrolling past everything that does not.
 *
 * Five facts decide that, and they are the five columns. The name says which
 * monitor. The status says whether a person or a cap stopped it. The next run
 * says whether waiting is the right thing to do. The last poll says what the
 * last collection did, which is US-104's whole point. And the matches found
 * say whether any of it produced anything — the one measure of the outcome,
 * beside four measures of the work.
 *
 * Everything else lives on `MonitorDetail`, one click away. Pause and resume
 * stay here: it is the action a person takes *from* the list, prompted by the
 * status column beside it, and a page in between is the detour this screen was
 * rewritten to remove.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { messageFor, requestJson } from "./api.js";
import { BrandIcon } from "./BrandIcon.js";
import { platformName } from "./labels.js";
import { type Monitor, needsAttention, nextPollLabel, pollSummary, status } from "./monitor.js";
import { paths } from "./route.js";

type LoadState = "loading" | "ready" | "error";

/**
 * What a row says under "Next run".
 *
 * Three answers rather than a blank: a paused monitor is not late, a monitor
 * that has never polled is not overdue, and an empty cell reads as neither.
 */
function nextRunLabel(monitor: Monitor): string {
  if (monitor.paused) return "Paused";
  if (!monitor.lastPolledAt) return "Waiting for the first poll";

  return nextPollLabel(monitor) ?? "—";
}

/** What a row says under "Last poll", without opening anything. */
function lastPollLabel(monitor: Monitor): string {
  return monitor.lastPoll ? pollSummary(monitor.lastPoll) : "No poll recorded yet";
}

function MonitorsHeader({ projectId }: { readonly projectId: string }) {
  return (
    <header className="topbar">
      <div>
        <h1>Monitors</h1>
        <p className="page-subtitle">Keep an eye on the conversations that matter.</p>
      </div>
      <Link className="top-primary-button" to={paths.newMonitor(projectId)}>
        <span aria-hidden="true">+</span> New monitor
      </Link>
    </header>
  );
}

/**
 * The monitors of one project. US-045, US-076.
 *
 * The project comes from the address and reaches this screen as a prop. The
 * list is filtered here rather than on the server: it is small, the response
 * already carries the project on every row, and a query parameter would be a
 * second place for the same rule to live.
 */
export function Monitors({ projectId }: { readonly projectId: string }) {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const [pending, setPending] = useState<string[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

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
        <MonitorsHeader projectId={projectId} />
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
        <MonitorsHeader projectId={projectId} />
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
        <MonitorsHeader projectId={projectId} />
        <div className="center-state page-state">
          <span className="empty-mark" aria-hidden="true">
            ◎
          </span>
          <h2>No monitors yet</h2>
          <p>Create a monitor and SignalScout will start collecting conversations.</p>
          <Link className="primary-button" to={paths.newMonitor(projectId)}>
            Create a monitor
          </Link>
        </div>
      </div>
    );
  }

  const scoped = monitors.filter((monitor) => monitor.projectId === projectId);
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
      <MonitorsHeader projectId={projectId} />
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
          <a className="secondary-button" href="/api/feedback/export">
            Export feedback as JSON
          </a>
        </div>
        <div className="monitors-filter-panel">
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
                <button
                  type="button"
                  key={id}
                  aria-pressed={view === id}
                  onClick={() => setView(id)}
                >
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
          <p className="monitors-result-count" role="status">
            Showing {visible.length} of {scoped.length} monitors in this project
          </p>
        </div>
        {error && (
          <p className="budget-error" role="alert">
            {error}
          </p>
        )}
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
              <Link className="primary-button" to={paths.newMonitor(projectId)}>
                Create a monitor
              </Link>
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
            <MonitorTable
              monitors={group.monitors}
              setPaused={setPaused}
              pending={pending}
              projectId={projectId}
            />
          </section>
        ))}
        <p className="monitors-cost-note">
          Spend is estimated; your provider’s invoice is the authority. Open a monitor for what it
          has spent and what it may still spend.
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
 * One group's rows.
 *
 * `setPaused` belongs to the page, so it is passed in rather than reached for:
 * this is one table among several on the screen, and a component that closed
 * over the page's state could only ever render one of them.
 */
function MonitorTable({
  monitors,
  setPaused,
  pending,
  projectId,
}: {
  monitors: Monitor[];
  pending: string[];
  projectId: string;
  setPaused: (monitor: Monitor, paused: boolean) => Promise<void>;
}) {
  return (
    <div className="monitor-table-scroll">
      <table className="monitor-table">
        <thead>
          <tr>
            <th scope="col">Monitor</th>
            <th scope="col">Status</th>
            <th scope="col">Next run</th>
            <th scope="col">Last poll</th>
            <th scope="col">Found</th>
            {/* No heading: the cell holds one action, and "Actions" is a word
                that describes the column rather than naming anything in it. */}
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {monitors.map((monitor) => {
            const running = status(monitor);

            return (
              <tr key={monitor.id}>
                <th scope="row">
                  <Link
                    className="monitor-table-name"
                    to={paths.monitor(monitor.projectId ?? projectId, monitor.id)}
                  >
                    {monitor.name}
                  </Link>
                  <span className="monitor-table-sources">
                    {monitor.sources.length > 0
                      ? monitor.sources.map((source) => (
                          <span key={source} className="brand-label">
                            <BrandIcon brand={source} size={14} />
                            {platformName(source)}
                          </span>
                        ))
                      : "No source"}
                  </span>
                </th>
                <td>
                  <span
                    className={`monitor-status ${running.tone}${running.attention ? " quiet" : ""}`}
                  >
                    {running.label}
                  </span>
                  {/* A broken webhook does not change what the monitor is
                      doing, so it is not the status word — but it is why this
                      row is counted under "Needs attention", and a count a
                      person cannot act on from the list sends them hunting
                      through every monitor. */}
                  {monitor.notificationIssues?.map((issue) => (
                    <small key={issue} className="monitor-table-note">
                      {issue}
                    </small>
                  ))}
                </td>
                <td>{nextRunLabel(monitor)}</td>
                <td className="monitor-table-poll">{lastPollLabel(monitor)}</td>
                <td className="monitor-table-found">
                  {/* Two numbers rather than one. "Sixty found, none read" and
                      "sixty found, all read" send a person to two different
                      places, and one total says neither. A build whose API
                      does not carry the count says so rather than showing a
                      zero nothing measured. */}
                  {monitor.matches ? (
                    <>
                      <strong>{monitor.matches.total}</strong>
                      <small>{monitor.matches.unread} unread</small>
                    </>
                  ) : (
                    <small>—</small>
                  )}
                </td>
                <td className="monitor-table-actions">
                  <button
                    type="button"
                    className="compact-button"
                    disabled={pending.includes(monitor.id)}
                    onClick={() => void setPaused(monitor, !monitor.paused)}
                  >
                    {pending.includes(monitor.id)
                      ? "Updating…"
                      : monitor.paused
                        ? "Resume"
                        : "Pause"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
