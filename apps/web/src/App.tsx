import { useEffect, useState } from "react";
import { requestJson } from "./api.js";
import { Connections } from "./Connections.js";
import { Inbox } from "./Inbox.js";
import { type AuthStatus, Login } from "./Login.js";
import { Models } from "./Models.js";
import { MonitorForm } from "./MonitorForm.js";
import { Monitors } from "./Monitors.js";
import { Notifications } from "./Notifications.js";
import { Projects } from "./Projects.js";
import { Providers } from "./Providers.js";
import { ReplyVoices } from "./ReplyVoices.js";
import { routeParam, routePath } from "./route.js";

/**
 * The shell: the header, and which of the four screens is on it.
 *
 * The route lives in the hash rather than the path. Fastify already serves
 * `index.html` for any path that is not an API route or a file, so a path
 * router would work — but it would also need history handling this app has no
 * use for yet, and a hash is one listener.
 *
 * **The inbox was the default until US-045, and now the projects list is.**
 * That reverses a decision this comment used to state, so it is written down
 * rather than quietly changed. PLAN.md is firm that the product *is* the
 * inbox, and it still is — but an inbox is a question about one business, and
 * once monitors belong to projects there is no honest answer to "show me the
 * inbox" with no project named. Answering for every project at once is exactly
 * what grouping was added to stop.
 *
 * So a person with no project chosen is sent to choose one. Somebody with a
 * single project pays one click; somebody with several gets an inbox that
 * means something. The original reasoning holds inside a project: landing on
 * its inbox rather than on the setup form is still right, and a project with
 * no monitors is told so and offered the form.
 */

const newMonitorRoute = "#/monitors/new";
const monitorsRoute = "#/monitors";
const connectionsRoute = "#/connections";
const projectsRoute = "#/projects";
const providersRoute = "#/providers";
const replyVoicesRoute = "#/reply-voices";
const modelsRoute = "#/models";

function currentRoute(): string {
  return globalThis.location?.hash ?? "";
}

/**
 * Who is looking, asked once on load. US-017.
 *
 * `null` while the question is out, and that state renders nothing rather than
 * a login form. A form shown for the moment before the answer arrives would
 * flash at the person who is already signed in, every single load.
 */
function useAuthStatus(): AuthStatus | null {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    let current = true;

    requestJson<AuthStatus>("/api/auth-status")
      .then((answer) => {
        if (current) setStatus(answer);
      })
      .catch(() => {
        // An instance that cannot answer this cannot be signed in to, so the
        // safe reading is signed out, and closed: an offer to register that we
        // could not confirm is an offer that will refuse.
        if (current) {
          setStatus({ firstRun: false, signUpOpen: false, signedIn: false, account: null });
        }
      });

    return () => {
      current = false;
    };
  }, []);

  return status;
}

export function App() {
  const status = useAuthStatus();
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    globalThis.addEventListener("hashchange", onChange);
    return () => globalThis.removeEventListener("hashchange", onChange);
  }, []);

  // The longer route is tested first: "#/monitors" is a prefix of
  // "#/monitors/new", and testing the shorter one first would put the list on
  // the screen for both.
  const path = routePath(route);
  const notificationId = /^#\/monitors\/([0-9a-f-]+)\/notifications$/.exec(path)?.[1];
  const creating = path.startsWith(newMonitorRoute);
  const listing = !creating && path.startsWith(monitorsRoute);
  const connecting = path.startsWith(connectionsRoute);
  const projecting = path.startsWith(projectsRoute);
  const comparing = path.startsWith(providersRoute);
  const voicing = path.startsWith(replyVoicesRoute);
  const modelling = path.startsWith(modelsRoute);

  /**
   * The project everything else is about, carried in the route. US-045.
   *
   * An inbox and a list of monitors are questions about *a business*, so they
   * mean nothing until one is chosen. On the projects page there is no project
   * yet, and the two links are hidden rather than shown pointing at everything
   * — a link that silently means "all businesses at once" is the thing this
   * grouping exists to remove.
   */
  const signedIn = status?.signedIn === true;
  const projectId = routeParam("project", route);
  const scoped = projectId === null ? "" : `?project=${projectId}`;

  /**
   * The screens that mean nothing without a project, and the guard for them.
   *
   * The inbox, the monitor list and the monitor form are all questions about
   * one business. Reached without a project they would answer for every
   * business at once, which is what grouping exists to remove — and it is not
   * enough to scope the links, because a bookmark, a typed address or a link
   * somebody forgot to update all arrive here too.
   *
   * So the requirement lives in the router: no project, no inbox. A person is
   * sent to choose one, and the address is corrected to match what they are
   * looking at rather than left saying something untrue.
   */
  // Pricing joins Connections as a machine-level screen: one set of keys, one
  // set of prices, every project. Asking it to pick a project first would ask a
  // question it has no use for.
  const needsProject =
    !projecting && !connecting && !comparing && !voicing && !modelling && !notificationId;
  const withoutProject = needsProject && projectId === null;

  useEffect(() => {
    if (signedIn && withoutProject) globalThis.location.hash = projectsRoute;
  }, [signedIn, withoutProject]);

  // Nothing at all until the answer is back. See `useAuthStatus`.
  if (status === null) return null;
  if (!status.signedIn) {
    return <Login firstRun={status.firstRun} signUpOpen={status.signUpOpen} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href={projectsRoute} aria-label="IntentWatch home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>intentwatch</span>
        </a>

        <nav className="site-nav" aria-label="Screens">
          <a className={projecting ? "nav-item current" : "nav-item"} href={projectsRoute}>
            <span className="nav-icon" aria-hidden="true">
              ▦
            </span>
            <span>Projects</span>
          </a>

          {/*
            Only when a project is in the route.
            
            Not "everywhere except the projects page": Connections is a
            machine-level screen — one key, every project — so it carries no
            project either, and offering an inbox link there would offer one
            that answers for all of them.
          */}
          {projectId !== null && (
            <>
              <a
                className={creating || listing || connecting ? "nav-item" : "nav-item current"}
                href={`#/${scoped}`}
              >
                <span className="nav-icon" aria-hidden="true">
                  ▤
                </span>
                <span>Intent inbox</span>
              </a>
              <a
                className={listing ? "nav-item current" : "nav-item"}
                href={`${monitorsRoute}${scoped}`}
              >
                <span className="nav-icon" aria-hidden="true">
                  ◎
                </span>
                <span>Monitors</span>
              </a>
            </>
          )}
          <a className={connecting ? "nav-item current" : "nav-item"} href={connectionsRoute}>
            <span className="nav-icon" aria-hidden="true">
              ⚿
            </span>
            <span>Connections</span>
          </a>
          <a className={comparing ? "nav-item current" : "nav-item"} href={providersRoute}>
            <span className="nav-icon" aria-hidden="true">
              ⌗
            </span>
            <span>Providers</span>
          </a>
          <a className={voicing ? "nav-item current" : "nav-item"} href={replyVoicesRoute}>
            <span className="nav-icon" aria-hidden="true">
              ✎
            </span>
            <span>Reply voices</span>
          </a>
          {/*
            Beside Connections and Providers rather than inside a project: a
            model key is one account's, for every project it runs. US-068.
          */}
          <a className={modelling ? "nav-item current" : "nav-item"} href={modelsRoute}>
            <span className="nav-icon" aria-hidden="true">
              ◈
            </span>
            <span>Models</span>
          </a>
          {/*
            Also only with a project: a monitor is made in one, and the form
            prefills its four answers from it. Offered without one it would
            make an unfiled monitor, the state migration 0038 emptied out.
          */}
          {projectId !== null && (
            <a
              className={creating ? "nav-item new-monitor-nav current" : "nav-item new-monitor-nav"}
              href={`${newMonitorRoute}${scoped}`}
            >
              <span className="nav-icon" aria-hidden="true">
                +
              </span>
              <span>New monitor</span>
            </a>
          )}
        </nav>

        {/*
          Who is signed in, where a hardcoded "Self-hosted" pill used to be.
          US-069. That label was written before there were accounts and was true
          then; it is false on an instance taking registrations, and it occupied
          the one place a person looks to find out which account they are using.
        */}
        <div className="sidebar-bottom">
          {status.account && (
            <div className="signed-in-as">
              <strong>{status.account.name}</strong>
              <span>{status.account.email}</span>
            </div>
          )}
          <SignOut />
        </div>
      </aside>

      <main className="app-main">
        {withoutProject ? (
          <Projects />
        ) : notificationId ? (
          <Notifications key={notificationId} monitorId={notificationId} />
        ) : creating ? (
          <MonitorForm />
        ) : projecting ? (
          <Projects />
        ) : connecting ? (
          <Connections />
        ) : comparing ? (
          <Providers />
        ) : voicing ? (
          <ReplyVoices />
        ) : modelling ? (
          <Models />
        ) : listing ? (
          <Monitors />
        ) : (
          <Inbox />
        )}
      </main>
    </div>
  );
}

/**
 * Signing out.
 *
 * A `POST`, because it changes something on the server: the row in `sessions`
 * is deleted, so the cookie the browser keeps stops meaning anything even if
 * somebody copied it. A link that only cleared the cookie would leave a
 * working session behind on a machine somebody has walked away from.
 */
function SignOut() {
  const [busy, setBusy] = useState(false);

  async function signOut(): Promise<void> {
    setBusy(true);

    try {
      await requestJson("/api/auth/sign-out", { method: "POST" });
    } finally {
      // Reload either way. A sign-out the server refused still has to put the
      // person somewhere honest, and the reload asks it who they are again.
      globalThis.location.reload();
    }
  }

  return (
    <button className="sign-out" disabled={busy} type="button" onClick={signOut}>
      Sign out
    </button>
  );
}
