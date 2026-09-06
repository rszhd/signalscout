import { useEffect, useState } from "react";
import { Connections } from "./Connections.js";
import { Inbox } from "./Inbox.js";
import { MonitorForm } from "./MonitorForm.js";
import { Monitors } from "./Monitors.js";
import { Notifications } from "./Notifications.js";
import { Projects } from "./Projects.js";

/**
 * The shell: the header, and which of the four screens is on it.
 *
 * The route lives in the hash rather than the path. Fastify already serves
 * `index.html` for any path that is not an API route or a file, so a path
 * router would work — but it would also need history handling this app has no
 * use for yet, and a hash is one listener.
 *
 * The inbox is the default. PLAN.md is firm that the product *is* the inbox,
 * and a fresh install that lands there is told it has no monitors and offered
 * the form. Landing on the form instead would put the setup screen in front of
 * everyone who already finished setting up.
 */

const newMonitorRoute = "#/monitors/new";
const monitorsRoute = "#/monitors";
const connectionsRoute = "#/connections";
const projectsRoute = "#/projects";

function currentRoute(): string {
  return globalThis.location?.hash ?? "";
}

export function App() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    globalThis.addEventListener("hashchange", onChange);
    return () => globalThis.removeEventListener("hashchange", onChange);
  }, []);

  // The longer route is tested first: "#/monitors" is a prefix of
  // "#/monitors/new", and testing the shorter one first would put the list on
  // the screen for both.
  const notificationId = /^#\/monitors\/([0-9a-f-]+)\/notifications$/.exec(route)?.[1];
  const creating = route.startsWith(newMonitorRoute);
  const listing = !creating && route.startsWith(monitorsRoute);
  const connecting = route.startsWith(connectionsRoute);
  const projecting = route.startsWith(projectsRoute);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#/" aria-label="IntentWatch home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>intentwatch</span>
        </a>

        <nav className="site-nav" aria-label="Screens">
          <a
            className={
              creating || listing || connecting || projecting ? "nav-item" : "nav-item current"
            }
            href="#/"
          >
            <span className="nav-icon" aria-hidden="true">
              ▤
            </span>
            <span>Intent inbox</span>
          </a>
          <a className={projecting ? "nav-item current" : "nav-item"} href={projectsRoute}>
            <span className="nav-icon" aria-hidden="true">
              ▦
            </span>
            <span>Projects</span>
          </a>
          <a className={listing ? "nav-item current" : "nav-item"} href={monitorsRoute}>
            <span className="nav-icon" aria-hidden="true">
              ◎
            </span>
            <span>Monitors</span>
          </a>
          <a className={connecting ? "nav-item current" : "nav-item"} href={connectionsRoute}>
            <span className="nav-icon" aria-hidden="true">
              ⚿
            </span>
            <span>Connections</span>
          </a>
          <a
            className={creating ? "nav-item new-monitor-nav current" : "nav-item new-monitor-nav"}
            href={newMonitorRoute}
          >
            <span className="nav-icon" aria-hidden="true">
              +
            </span>
            <span>New monitor</span>
          </a>
        </nav>

        <div className="sidebar-bottom">
          <span className="local-pill">Self-hosted</span>
        </div>
      </aside>

      <main className="app-main">
        {notificationId ? (
          <Notifications key={notificationId} monitorId={notificationId} />
        ) : creating ? (
          <MonitorForm />
        ) : projecting ? (
          <Projects />
        ) : connecting ? (
          <Connections />
        ) : listing ? (
          <Monitors />
        ) : (
          <Inbox />
        )}
      </main>
    </div>
  );
}
