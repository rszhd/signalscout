import { useEffect, useRef, useState } from "react";
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useMatch,
  useNavigate,
  useParams,
} from "react-router";
import { requestJson } from "./api.js";
import { Billing, type BillingState, subscriptionSentence } from "./Billing.js";
import { BrandLogo } from "./BrandLogo.js";
import { Connections } from "./Connections.js";
import { Inbox } from "./Inbox.js";
import { type AuthStatus, Login } from "./Login.js";
import { Models } from "./Models.js";
import { MonitorDetail } from "./MonitorDetail.js";
import { MonitorForm } from "./MonitorForm.js";
import { Monitors } from "./Monitors.js";
import { Notifications } from "./Notifications.js";
import {
  type ConnectionsView,
  hasModelKey,
  hasProviderKey,
  type ModelsView,
  Onboarding,
} from "./Onboarding.js";
import { ProjectForm, Projects } from "./Projects.js";
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
            onboarded: false,
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

/**
 * The two keys this account needs before the product does anything. US-088.
 *
 * Read here rather than inside the setup screen, because the answer decides
 * whether that screen is shown at all — and a second read inside it could
 * disagree with this one about what is missing.
 *
 * **A failed read opens the gate.** `null` means the question was not
 * answered, and locking somebody out of their own inbox because one request
 * failed is worse than letting an unconfigured account through: the monitor
 * form refuses a platform with no key anyway, and every poll is refused with a
 * reason. The gate is for the common path, not a security boundary.
 */
interface SetupViews {
  readonly connections: ConnectionsView;
  readonly models: ModelsView;
}

function useSetup(enabled: boolean): {
  views: SetupViews | null;
  answered: boolean;
  replace: (views: { connections?: ConnectionsView; models?: ModelsView }) => void;
  dismiss: () => void;
} {
  const [views, setViews] = useState<SetupViews | null>(null);
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    let current = true;

    if (!enabled) {
      setAnswered(true);
      return () => {
        current = false;
      };
    }

    Promise.all([
      requestJson<ConnectionsView>("/api/connections"),
      requestJson<ModelsView>("/api/models"),
    ])
      .then(([connections, models]) => {
        if (current) setViews({ connections, models });
      })
      .catch(() => {
        // See above: an unanswered question opens the gate rather than closing
        // it. `views` stays null, which reads as "nothing to ask for".
      })
      .finally(() => {
        if (current) setAnswered(true);
      });

    return () => {
      current = false;
    };
  }, [enabled]);

  return {
    views,
    answered,
    replace: (updated) => setViews((current) => (current ? { ...current, ...updated } : current)),
    // Pressing the last button on the setup screen. The keys are in, so there
    // is nothing left to gate on.
    dismiss: () => setViews(null),
  };
}

export function App() {
  const navigate = useNavigate();
  const status = useAuthStatus();
  const billingState = useBillingState(
    status?.signedIn === true && status.billingMode === "stripe",
  );
  const setup = useSetup(status?.signedIn === true);

  /**
   * The setup gate sends a new account to make its first project.
   *
   * The gate is not a route and has no address, so it cannot navigate. This
   * effect watches for it *closing*: an account with no project that has just
   * put its two keys in is a brand-new account, and the next honest step is
   * describing a business — not landing on an empty list. An account that
   * already has projects is left where the gate let it through.
   *
   * `wasGated` is what tells the two apart. The effect sets it while the gate
   * is on screen, so the read fires only on the moment the gate ends and never
   * again on later loads — an account that refreshes after setup must not be
   * herded back to the create form.
   */
  const wasGated = useRef(false);

  useEffect(() => {
    if (!setup.answered || setup.views === null) return;

    const missingKeys = !(
      hasProviderKey(setup.views.connections) && hasModelKey(setup.views.models)
    );

    // An account that already set up is never gated, so it is never "closing"
    // a gate either. US-105.
    if (!status?.onboarded && missingKeys) {
      wasGated.current = true;
      return;
    }
    if (!wasGated.current) return;
    wasGated.current = false;

    let current = true;
    requestJson<{ projects: unknown[] }>("/api/projects")
      .then((answer) => {
        if (current && answer.projects.length === 0) {
          navigate(paths.newProject, { replace: true });
        }
      })
      .catch(() => {
        // A read that failed says nothing. The projects list is the honest
        // landing, and it will say so itself.
      });

    return () => {
      current = false;
    };
  }, [setup.answered, setup.views, status?.onboarded, navigate]);

  /**
   * Record that setup is finished, once the account holds both keys. US-105.
   *
   * The gate's own condition decides this, so there is no second copy of the
   * rule: whenever both keys are present — stored on the account or in the
   * instance's environment — the account has set up, and it must not be sent
   * back here after it removes them.
   *
   * The insert is idempotent, so the ref only avoids a request per render. A
   * failed call is retried on the next load, where `/api/auth-status` still
   * answers that the account is not onboarded.
   */
  const recordedSetup = useRef(false);

  useEffect(() => {
    if (recordedSetup.current || status?.onboarded) return;
    if (!setup.views) return;
    if (!(hasProviderKey(setup.views.connections) && hasModelKey(setup.views.models))) return;

    recordedSetup.current = true;
    requestJson("/api/onboarding", { method: "PUT" }).catch(() => {
      // Nothing to say here. The gate is not a boundary, and the next load
      // asks again.
    });
  }, [setup.views, status?.onboarded]);

  // Nothing at all until the answer is back. See `useAuthStatus`.
  if (status === null) return null;
  if (!status.signedIn) {
    return <Login firstRun={status.firstRun} signUpOpen={status.signUpOpen} />;
  }

  // Nothing until the setup question is answered either, for the same reason:
  // the application flashing on screen before the gate replaces it is worse
  // than a moment of nothing.
  if (!setup.answered) return null;

  /**
   * The two keys, before the product — for an account that has not set up
   * before. US-088, narrowed by US-105.
   *
   * In place of the whole application rather than as a route inside it, which
   * is how the login above works and for the same reason: a route can be
   * navigated away from, and the first version of this was — a new account
   * stepped around setup in one click and met the missing key later, on the
   * monitor form, as a refusal it could not act on.
   *
   * **Only a new account.** An account that completed setup once is let in
   * even with no key at all, because it is not new and the forms behind this
   * point already refuse it with a reason. `onboarded` is the record of that;
   * `App.test.tsx` holds the case.
   */
  if (
    setup.views &&
    !status.onboarded &&
    !(hasProviderKey(setup.views.connections) && hasModelKey(setup.views.models))
  ) {
    return (
      <Onboarding
        connections={setup.views.connections}
        models={setup.views.models}
        onSaved={setup.replace}
        onFinished={setup.dismiss}
      />
    );
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
        {/*
          The project editor's own address. US-045's editor used to be a state
          of the list; it is a page now, so the setup gate can send a new
          account to it. `new` is a static segment, which outranks the `:id`
          of the inbox route below it.
        */}
        <Route path={routes.newProject} element={<NewProjectRoute />} />
        <Route path={routes.editProject} element={<EditProjectRoute />} />
        <Route path={routes.inbox} element={<InboxRoute />} />
        <Route path={routes.monitors} element={<MonitorsRoute />} />
        <Route path={routes.newMonitor} element={<MonitorFormRoute />} />
        <Route path={routes.monitor} element={<MonitorRoute />} />
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
  const creating = useMatch(routes.newProject) !== null;
  const inside = useMatch(`${routes.inbox}/*`);
  const exact = useMatch(routes.inbox);
  // `/projects/new` is the create form, not a project whose id is "new".
  if (creating) return null;
  return inside?.params.projectId ?? exact?.params.projectId ?? null;
}

function NewProjectRoute() {
  return <ProjectForm projectId={null} />;
}

function EditProjectRoute() {
  const { projectId } = useParams();
  return projectId ? (
    <ProjectForm key={projectId} projectId={projectId} />
  ) : (
    <Navigate replace to={paths.projects} />
  );
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
 * One monitor's page. US-109.
 *
 * The `key` remounts it for `NotificationsRoute`'s reason: two monitors match
 * the same route, so React would otherwise keep the other one's loaded state
 * on the screen.
 */
function MonitorRoute() {
  const { projectId, monitorId } = useParams();
  return projectId && monitorId ? (
    <MonitorDetail key={monitorId} monitorId={monitorId} projectId={projectId} />
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

type NavIconName =
  | "projects"
  | "inbox"
  | "monitors"
  | "add"
  | "providers"
  | "voices"
  | "models"
  | "billing";

const navIconPaths: Record<NavIconName, string> = {
  projects: "M4 6.5h6l2 2h8v10H4z",
  inbox: "M4 5h16v14H4z M4 13h4l2 2h4l2-2h4",
  monitors: "M12 20a8 8 0 1 0-8-8 M12 16a4 4 0 1 0-4-4 M12 12h.01",
  add: "M12 5v14 M5 12h14",
  providers: "M8 4v5 M16 4v5 M6 9h12v2a6 6 0 0 1-6 6v3",
  voices: "M5 19l4-.8L18 9.2a2.1 2.1 0 0 0-3-3L5.8 15z M13.8 7.4l2.8 2.8",
  models: "M12 3l1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4z M18.5 15v5 M16 17.5h5",
  billing: "M4 6h16v12H4z M4 10h16 M7 15h4",
};

function NavIcon({ name }: { readonly name: NavIconName }) {
  return (
    <span className="nav-icon" aria-hidden="true">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d={navIconPaths[name]} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
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
  // The project editor is a page of its own, and the Projects item stays
  // current while a project is being made or edited.
  const listingProjects = useMatch(routes.projects) !== null;
  const addingProject = useMatch(routes.newProject) !== null;
  const editingProject = useMatch(routes.editProject) !== null;
  const projecting = listingProjects || addingProject || editingProject;
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
            <NavIcon name="projects" />
            <span>Projects</span>
          </Link>

          {/*
            Only when a project is in the address.

            The project screens all need it. The page without one should not
            offer an inbox that answers for every business.
          */}
          {projectId !== null && (
            <>
              <Link
                className={reading ? "nav-item current" : "nav-item"}
                to={paths.inbox(projectId)}
              >
                <NavIcon name="inbox" />
                <span>Intent inbox</span>
              </Link>
              <Link
                className={listing ? "nav-item current" : "nav-item"}
                to={paths.monitors(projectId)}
              >
                <NavIcon name="monitors" />
                <span>Monitors</span>
              </Link>
            </>
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
              <NavIcon name="add" />
              <span>New monitor</span>
            </Link>
          )}
        </nav>

        <div className="sidebar-bottom">
          {/*
            Account-level navigation now sits beside the account, not beside
            the project flow. US-021 kept the project screens here; these four
            belong with the signed-in person instead.
          */}
          <nav className="account-nav" aria-label="Account">
            <p className="sidebar-section-label">Account</p>
            <Link className={comparing ? "nav-item current" : "nav-item"} to={paths.providers}>
              <NavIcon name="providers" />
              <span>Providers</span>
            </Link>
            <Link className={voicing ? "nav-item current" : "nav-item"} to={paths.replyVoices}>
              <NavIcon name="voices" />
              <span>Voices</span>
            </Link>
            {/*
              Beside Providers rather than inside a project: a model key is one
              account's, for every project it runs. US-068.
            */}
            <Link className={modelling ? "nav-item current" : "nav-item"} to={paths.models}>
              <NavIcon name="models" />
              <span>Models</span>
            </Link>
            {/*
              Only where this instance charges. US-072. A self-hosted instance
              has no subscription, so a Billing link there would open a page
              that can only say so — and the route it reads is not even
              registered.
            */}
            {status.billingMode === "stripe" && (
              <Link className={billing ? "nav-item current" : "nav-item"} to={paths.billing}>
                <NavIcon name="billing" />
                <span>Billing</span>
              </Link>
            )}
          </nav>

          {/*
            Who is signed in, where a hardcoded "Self-hosted" pill used to be.
            US-069. That label was written before there were accounts and was
            true then; it is false on an instance taking registrations, and it
            occupied the one place a person looks to find out which account
            they are using.
          */}
          {status.account && (
            <div className="signed-in-as">
              <span className="account-avatar" aria-hidden="true">
                {status.account.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="account-identity">
                <strong>{status.account.name}</strong>
                <span>{status.account.email}</span>
              </span>
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
