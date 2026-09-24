import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { requestJson } from "./api.js";

/**
 * The parts a navigation is built from: an icon, an item, the signed-in
 * person, and signing out. US-355.
 *
 * **The parts are shared; the navigation is not.** Which items a sidebar
 * shows, in which order and under which heading is each application's, and
 * the two differ: self-hosted a project's Inbox, Monitors and New monitor sit
 * under Projects, hosted the account's projects are listed there. Each
 * application writes its own shell from these parts, and the look of every
 * part — and of the sidebar, the phone's bottom bar and the account sheet —
 * is `sidebar.css`.
 */

export type NavIconName =
  | "projects"
  | "inbox"
  | "monitors"
  | "add"
  | "providers"
  | "voices"
  | "models"
  | "billing"
  | "account"
  | "docs";

const navIconPaths: Record<NavIconName, string> = {
  projects: "M4 6.5h6l2 2h8v10H4z",
  inbox: "M4 5h16v14H4z M4 13h4l2 2h4l2-2h4",
  monitors: "M12 20a8 8 0 1 0-8-8 M12 16a4 4 0 1 0-4-4 M12 12h.01",
  add: "M12 5v14 M5 12h14",
  providers: "M8 4v5 M16 4v5 M6 9h12v2a6 6 0 0 1-6 6v3",
  voices: "M5 19l4-.8L18 9.2a2.1 2.1 0 0 0-3-3L5.8 15z M13.8 7.4l2.8 2.8",
  models: "M12 3l1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4z M18.5 15v5 M16 17.5h5",
  billing: "M4 6h16v12H4z M4 10h16 M7 15h4",
  account: "M12 11.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8 M5.4 19.6a6.6 6.6 0 0 1 13.2 0",
  docs: "M12 6.5C10.5 5.3 8 5 4 5v13c4 0 6.5.3 8 1.5 1.5-1.2 4-1.5 8-1.5V5c-4 0-6.5.3-8 1.5z M12 6.5v13",
};

export function NavIcon({ name }: { readonly name: NavIconName }) {
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

interface NavItemBase {
  readonly icon: NavIconName;
  readonly label: string;
  /** Whether the reader is on this item's screen: `aria-current="page"`. */
  readonly current?: boolean;
  readonly className?: string;
}

/**
 * One item: a link to a screen, a link to another site such as the docs, or —
 * for the account sheet on a phone — a button that opens something. Only one
 * item in a navigation is current, and an item on another site never is.
 */
export type NavItemProps =
  | (NavItemBase & { readonly to: string; readonly href?: never; readonly onClick?: never })
  | (NavItemBase & { readonly href: string; readonly to?: never; readonly onClick?: never })
  | (NavItemBase & { readonly onClick: () => void; readonly to?: never; readonly href?: never });

export function NavItem(props: NavItemProps) {
  const { icon, label, current = false, className } = props;
  const classes = ["nav-item", className, current ? "current" : null].filter(Boolean).join(" ");
  const content = (
    <>
      <NavIcon name={icon} />
      <span>{label}</span>
    </>
  );

  // A new tab, so a person reading the docs does not lose the screen they
  // were on.
  if (props.href !== undefined) {
    return (
      <a className={classes} href={props.href} target="_blank" rel="noreferrer">
        {content}
      </a>
    );
  }

  if (props.to !== undefined) {
    return (
      <Link aria-current={current ? "page" : undefined} className={classes} to={props.to}>
        {content}
      </Link>
    );
  }

  return (
    <button
      aria-current={current ? "page" : undefined}
      className={classes}
      type="button"
      onClick={props.onClick}
    >
      {content}
    </button>
  );
}

/** Who is signed in: the first letter, the name and the address. */
export function AccountIdentity({
  name,
  email,
}: {
  readonly name: string;
  readonly email: string;
}) {
  return (
    <div className="signed-in-as">
      <span className="account-avatar" aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="account-identity">
        <strong>{name}</strong>
        <span title={email}>{email}</span>
      </span>
    </div>
  );
}

/**
 * Signing out: a `POST`, because it deletes the session on the server, so a
 * copied cookie stops meaning anything. A link that only cleared the cookie
 * would leave a working session behind on a machine somebody walked away
 * from. The page reloads either way, and the reload asks who the person is.
 */
export function SignOut({ children = "Sign out" }: { readonly children?: ReactNode }) {
  const [busy, setBusy] = useState(false);

  async function signOut(): Promise<void> {
    setBusy(true);
    try {
      await requestJson("/api/auth/sign-out", { method: "POST" });
    } catch {
      // A refusal changes nothing: the reload below asks who the person is.
    } finally {
      globalThis.location.reload();
    }
  }

  return (
    <button className="sign-out" disabled={busy} type="button" onClick={() => void signOut()}>
      {children}
    </button>
  );
}
