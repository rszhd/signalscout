import { useEffect, useState } from "react";
import { Inbox } from "./Inbox.js";
import { MonitorForm } from "./MonitorForm.js";
import { Monitors } from "./Monitors.js";

/**
 * The shell: the header, and which of the three screens is on it.
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
  const creating = route.startsWith(newMonitorRoute);
  const listing = !creating && route.startsWith(monitorsRoute);

  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="#/" aria-label="IntentWatch home">
          <span className="brand-mark" aria-hidden="true">
            iw
          </span>
          <span>IntentWatch</span>
        </a>
        <nav className="site-nav" aria-label="Screens">
          <a className={creating || listing ? "" : "current"} href="#/">
            Inbox
          </a>
          <a className={listing ? "current" : ""} href={monitorsRoute}>
            Monitors
          </a>
          <a className={creating ? "current" : ""} href={newMonitorRoute}>
            New monitor
          </a>
        </nav>
      </header>

      {creating ? <MonitorForm /> : listing ? <Monitors /> : <Inbox />}
    </main>
  );
}
