import {
  AccountIdentity,
  BrandLogo,
  Dialog,
  NavItem,
  ReplyVoices,
  requestJson,
  SignOut,
} from "@signalscout/ui";
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
import { paths, routes } from "./route.js";

/**
 * The shell: the header, and which of the four screens is on it.
 *
 * The route lives in the path, through React Router. US-076 moved it out of
 * the hash: Fastify already serves `index.html` for any path that is not an
 * API route or a file, so a path is a real address — and while the route lived
 * in the hash, a return from a payment page once read
 * `/billing?checkout=done#/billing`, one address saying the same thing twice.
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
          });
        }
      });

    return () => {
      current = false;
    };
  }, []);

  return status;
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
   * Connections, Providers, Reply voices and Models sit outside a project on
   * purpose: one set of keys, one set of prices, every project.
   */
  return (
    <Routes>
      <Route element={<Shell status={status} />}>
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
        <Route path={routes.inboxMatch} element={<InboxRoute />} />
        <Route path={routes.monitors} element={<MonitorsRoute />} />
        <Route path={routes.newMonitor} element={<MonitorFormRoute />} />
        <Route path={routes.monitor} element={<MonitorRoute />} />
        <Route path={routes.editMonitor} element={<EditMonitorRoute />} />
        <Route path={routes.notifications} element={<NotificationsRoute />} />
        <Route path={routes.connections} element={<Connections />} />
        <Route path={routes.providers} element={<Providers />} />
        <Route path={routes.replyVoices} element={<ReplyVoices />} />
        <Route path={routes.models} element={<Models />} />
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
  const { projectId, matchId } = useParams();
  return projectId ? (
    <Inbox projectId={projectId} matchId={matchId ?? null} />
  ) : (
    <Navigate replace to={paths.projects} />
  );
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

/** The monitor form, filled from one monitor. US-407. */
function EditMonitorRoute() {
  const { projectId, monitorId } = useParams();
  return projectId && monitorId ? (
    <MonitorForm key={monitorId} monitorId={monitorId} projectId={projectId} />
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

/** The public docs. Not a path in `route.ts`: it is another site. */
const docsUrl = "https://docs.signalscout.run/";

/** The sidebar, the banner, and whichever screen the address named. */
function Shell({ status }: { readonly status: AuthStatus }) {
  const projectId = useProjectId();
  const listing = useMatch(routes.monitors) !== null;
  const readingMonitor = useMatch(routes.monitor) !== null;
  const editingNotifications = useMatch(routes.notifications) !== null;
  const editingMonitor = useMatch(routes.editMonitor) !== null;
  const monitoring = listing || readingMonitor || editingNotifications || editingMonitor;
  const readingList = useMatch(routes.inbox) !== null;
  const readingItem = useMatch(routes.inboxMatch) !== null;
  const reading = readingList || readingItem;
  // The project editor is a page of its own, and the Projects item stays
  // current while a project is being made or edited.
  const listingProjects = useMatch(routes.projects) !== null;
  const addingProject = useMatch(routes.newProject) !== null;
  const editingProject = useMatch(routes.editProject) !== null;
  const projecting = listingProjects || addingProject || editingProject;
  const comparing = useMatch(routes.providers) !== null;
  const voicing = useMatch(routes.replyVoices) !== null;
  const modelling = useMatch(routes.models) !== null;
  const accounting = comparing || voicing || modelling;
  const accountSheet = useRef<HTMLDialogElement | null>(null);

  const accountLinks = (
    <>
      <NavItem icon="providers" label="Providers" to={paths.providers} current={comparing} />
      <NavItem icon="voices" label="Voices" to={paths.replyVoices} current={voicing} />
      {/*
        Beside Providers rather than inside a project: a model key is one
        account's, for every project it runs. US-068.
      */}
      <NavItem icon="models" label="Models" to={paths.models} current={modelling} />
    </>
  );

  // Outside the account list: the docs are nobody's account screen. Shown in
  // the sidebar and in the phone's sheet, because the bottom bar has no room.
  const docsLink = (
    <nav className="account-nav" aria-label="Help">
      <NavItem icon="docs" label="Docs" href={docsUrl} />
    </nav>
  );

  const signedInAs = status.account && (
    <AccountIdentity name={status.account.name} email={status.account.email} />
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to={paths.projects} aria-label="SignalScout home">
          <BrandLogo />
          <span>SignalScout</span>
        </Link>

        <nav className="site-nav" aria-label="Screens">
          <NavItem icon="projects" label="Projects" to={paths.projects} current={projecting} />

          {/*
            Only when a project is in the address.

            The project screens all need it. The page without one should not
            offer an inbox that answers for every business.
          */}
          {projectId !== null && (
            <>
              <NavItem icon="inbox" label="Inbox" to={paths.inbox(projectId)} current={reading} />
              <NavItem
                icon="monitors"
                label="Monitors"
                to={paths.monitors(projectId)}
                current={monitoring}
              />
            </>
          )}
          {/*
            Also only with a project: a monitor is made in one, and the form
            prefills its four answers from it. Offered without one it would
            make an unfiled monitor, the state migration 0038 emptied out.
          */}
          {projectId !== null && (
            <NavItem
              className="new-monitor-nav"
              icon="add"
              label="New monitor"
              to={paths.newMonitor(projectId)}
            />
          )}

          <NavItem
            className="account-sheet-button"
            icon="account"
            label="Account"
            current={accounting}
            onClick={() => accountSheet.current?.showModal()}
          />
        </nav>

        <div className="sidebar-bottom">
          {docsLink}

          {/*
            Account-level navigation now sits beside the account, not beside
            the project flow. US-021 kept the project screens here; these four
            belong with the signed-in person instead.
          */}
          <nav className="account-nav" aria-label="Account">
            <p className="sidebar-section-label">Account</p>
            {accountLinks}
          </nav>

          {/*
            Who is signed in, where a hardcoded "Self-hosted" pill used to be.
            US-069. That label was written before there were accounts and was
            true then; it is false on an instance taking registrations, and it
            occupied the one place a person looks to find out which account
            they are using.
          */}
          {signedInAs}
          <SignOut />
        </div>

        {/*
          The same account screens, for a phone. US-123.

          Below 820px the sidebar becomes a bottom bar and `.sidebar-bottom`
          is hidden, which left Providers, Voices, Models and Sign out
          reachable only by typing the address. The bar has room for four
          items at 320px, so the fifth is this sheet and the links live in it.
        */}
        <Dialog
          className="account-sheet"
          headingClass="account-sheet-heading"
          titleId="account-sheet-title"
          closeLabel="Close the account menu"
          heading={<h2 id="account-sheet-title">Account</h2>}
          dialogRef={accountSheet}
        >
          <div className="account-sheet-body">
            <nav className="account-nav" aria-label="Account screens">
              {accountLinks}
            </nav>
            {docsLink}
            {signedInAs}
            <SignOut />
          </div>
        </Dialog>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
