import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, Route, Routes, useMatch, useParams } from "react-router";
import { requestJson } from "./api.js";
import { Billing, type BillingState, subscriptionSentence } from "./Billing.js";
import { BrandLogo } from "./BrandLogo.js";
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
import { paths, routes } from "./route.js";

/**
 * The shell: the header, and which of the four screens is on it.
 *
 * The route lives in the path, through React Router. US-076 moved it out of
 * the hash: Fastify already serves `index.html` for any path that is not an
 * API route or a file, so a path is a real address — and while the route lived
 * in the hash, a Stripe return read `/billing?checkout=done#/billing`, which is
 * one address saying the same thing twice.
 *
 * The project is a path segment now, not a query parameter. `route.ts` holds
 * the whole table and explains why.
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
          setStatus({
            firstRun: false,
            signUpOpen: false,
            signedIn: false,
            account: null,
            billingMode: "off",
          });
        }
      });

    return () => {
      current = false;
    };
  }, []);

  return status;
}

/** The account's billing state, when this deployment has accounts to bill. */
function useBillingState(enabled: boolean): BillingState | null {
  const [state, setState] = useState<BillingState | null>(null);

  useEffect(() => {
    let current = true;

    if (!enabled) {
      setState(null);
      return () => {
        current = false;
      };
    }

    requestJson<BillingState>("/api/billing")
      .then((answer) => {
        if (current) setState(answer);
      })
      .catch(() => {
        // A failed read says nothing. Guessing here could label a paid account
        // as a trial, or tell somebody their trial ended when it did not.
      });

    return () => {
      current = false;
    };
  }, [enabled]);

  return state;
}

export function App() {
  const status = useAuthStatus();
  const billingState = useBillingState(
    status?.signedIn === true && status.billingMode === "stripe",
  );

  // Nothing at all until the answer is back. See `useAuthStatus`.
  if (status === null) return null;
  if (!status.signedIn) {
    return <Login firstRun={status.firstRun} signUpOpen={status.signUpOpen} />;
  }

  /**
   * The whole table, and the guard that does not depend on any link. US-045.
   *
   * The inbox, the monitor list and the monitor form are questions about one
   * business, so all three live *inside* a project rather than beside a
   * `?project=` a screen could be reached without. An address that names no
   * project therefore matches no such route, and the last line sends it to
   * choose one — which covers the bookmark, the typed address and the link
   * somebody forgot to update, none of which any href can reach.
   *
   * Connections, Providers, Reply voices, Models and Billing sit outside a
   * project on purpose: one set of keys, one set of prices, one subscription,
   * every project.
   */
  return (
    <Routes>
      <Route element={<Shell status={status} billingState={billingState} />}>
        <Route path={routes.projects} element={<Projects />} />
        <Route path={routes.inbox} element={<InboxRoute />} />
        <Route path={routes.monitors} element={<MonitorsRoute />} />
        <Route path={routes.newMonitor} element={<MonitorFormRoute />} />
        <Route path={routes.notifications} element={<NotificationsRoute />} />
        <Route path={routes.connections} element={<Connections />} />
        <Route path={routes.providers} element={<Providers />} />
        <Route path={routes.replyVoices} element={<ReplyVoices />} />
        <Route path={routes.models} element={<Models />} />
        {/*
          Only where this instance charges. US-072. A self-hosted instance has
          no subscription, so the route is not registered at all and the
          address falls through to the projects list.
        */}
        {status.billingMode === "stripe" && <Route path={routes.billing} element={<Billing />} />}
        <Route path="*" element={<Navigate replace to={paths.projects} />} />
      </Route>
    </Routes>
  );
}

/** The project in the address, on any route inside one. */
function useProjectId(): string | null {
  const inside = useMatch(`${routes.inbox}/*`);
  const exact = useMatch(routes.inbox);
  return inside?.params.projectId ?? exact?.params.projectId ?? null;
}

/**
 * A screen that needs a project reads it from the address, not from a prop.
 *
 * The route pattern guarantees the segment is there, and TypeScript cannot
 * know that, so the impossible case is written out rather than asserted away.
 */
function InboxRoute() {
  const { projectId } = useParams();
  return projectId ? <Inbox projectId={projectId} /> : <Navigate replace to={paths.projects} />;
}

function MonitorsRoute() {
  const { projectId } = useParams();
  return projectId ? <Monitors projectId={projectId} /> : <Navigate replace to={paths.projects} />;
}

function MonitorFormRoute() {
  const { projectId } = useParams();
  return projectId ? (
    <MonitorForm projectId={projectId} />
  ) : (
    <Navigate replace to={paths.projects} />
  );
}

/**
 * The `key` remounts the screen when the monitor changes.
 *
 * Moving between two monitors' notification settings matches the same route,
 * so React would keep the mounted component and its loaded settings — the
 * other monitor's — on the screen.
 */
function NotificationsRoute() {
  const { projectId, monitorId } = useParams();
  return projectId && monitorId ? (
    <Notifications key={monitorId} monitorId={monitorId} projectId={projectId} />
  ) : (
    <Navigate replace to={paths.projects} />
  );
}

/** The sidebar, the banner, and whichever screen the address named. */
function Shell({
  status,
  billingState,
}: {
  readonly status: AuthStatus;
  readonly billingState: BillingState | null;
}) {
  const projectId = useProjectId();
  const listing = useMatch(routes.monitors) !== null;
  const creating = useMatch(routes.newMonitor) !== null;
  const reading = useMatch(routes.inbox) !== null;
  const projecting = useMatch(routes.projects) !== null;
  const connecting = useMatch(routes.connections) !== null;
  const comparing = useMatch(routes.providers) !== null;
  const voicing = useMatch(routes.replyVoices) !== null;
  const modelling = useMatch(routes.models) !== null;
  const billing = useMatch(routes.billing) !== null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to={paths.projects} aria-label="SignalScout home">
          <BrandLogo />
          <span>SignalScout</span>
          {billingState?.reason === "trialing" && <span className="trial-badge">Trial</span>}
        </Link>

        <nav className="site-nav" aria-label="Screens">
          <Link className={projecting ? "nav-item current" : "nav-item"} to={paths.projects}>
            <span className="nav-icon" aria-hidden="true">
              ▦
            </span>
            <span>Projects</span>
          </Link>

          {/*
            Only when a project is in the address.

            Not "everywhere except the projects page": Connections is a
            machine-level screen — one key, every project — so it carries no
            project either, and offering an inbox link there would offer one
            that answers for all of them.
          */}
          {projectId !== null && (
            <>
              <Link
                className={reading ? "nav-item current" : "nav-item"}
                to={paths.inbox(projectId)}
              >
                <span className="nav-icon" aria-hidden="true">
                  ▤
                </span>
                <span>Intent inbox</span>
              </Link>
              <Link
                className={listing ? "nav-item current" : "nav-item"}
                to={paths.monitors(projectId)}
              >
                <span className="nav-icon" aria-hidden="true">
                  ◎
                </span>
                <span>Monitors</span>
              </Link>
            </>
          )}
          <Link className={connecting ? "nav-item current" : "nav-item"} to={paths.connections}>
            <span className="nav-icon" aria-hidden="true">
              ⚿
            </span>
            <span>Connections</span>
          </Link>
          <Link className={comparing ? "nav-item current" : "nav-item"} to={paths.providers}>
            <span className="nav-icon" aria-hidden="true">
              ⌗
            </span>
            <span>Providers</span>
          </Link>
          <Link className={voicing ? "nav-item current" : "nav-item"} to={paths.replyVoices}>
            <span className="nav-icon" aria-hidden="true">
              ✎
            </span>
            <span>Reply voices</span>
          </Link>
          {/*
            Beside Connections and Providers rather than inside a project: a
            model key is one account's, for every project it runs. US-068.
          */}
          <Link className={modelling ? "nav-item current" : "nav-item"} to={paths.models}>
            <span className="nav-icon" aria-hidden="true">
              ◈
            </span>
            <span>Models</span>
          </Link>
          {/*
            Only where this instance charges. US-072. A self-hosted instance has
            no subscription, so a Billing link there would open a page that can
            only say so — and the route it reads is not even registered.
          */}
          {status.billingMode === "stripe" && (
            <Link className={billing ? "nav-item current" : "nav-item"} to={paths.billing}>
              <span className="nav-icon" aria-hidden="true">
                ⬡
              </span>
              <span>Billing</span>
            </Link>
          )}
          {/*
            Also only with a project: a monitor is made in one, and the form
            prefills its four answers from it. Offered without one it would
            make an unfiled monitor, the state migration 0038 emptied out.
          */}
          {projectId !== null && (
            <Link
              className={creating ? "nav-item new-monitor-nav current" : "nav-item new-monitor-nav"}
              to={paths.newMonitor(projectId)}
            >
              <span className="nav-icon" aria-hidden="true">
                +
              </span>
              <span>New monitor</span>
            </Link>
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
        {/*
          Why a write was refused, said wherever a person is. US-072.

          The paywall answers 402 on every route that changes something, and a
          person meeting that on the monitor form would read it as the form
          being broken. The banner is the one place that says it is the
          subscription, and it carries the way out.
        */}
        {status.billingMode === "stripe" && !billing && <TrialBanner state={billingState} />}
        <Outlet />
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

/**
 * The trial, on every screen but the billing one.
 *
 * Shown only while there is something to say: the last two days of a trial, or
 * an account the server is already refusing. A banner that is always there is a
 * banner nobody reads, and this one has to be read on the day it matters.
 *
 * It reads the same route the billing page does, so the sentence here and the
 * sentence there cannot disagree.
 */
function TrialBanner({ state }: { readonly state: BillingState | null }) {
  if (!state) return null;

  const ending = state.reason === "trialing" && (state.trialDaysLeft ?? 99) <= 2;
  if (!ending && state.entitled) return null;

  return (
    <p className={state.entitled ? "trial-banner" : "trial-banner ended"} role="status">
      <span>{subscriptionSentence(state)}</span>
      <Link to={paths.billing}>Subscribe</Link>
    </p>
  );
}
