import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * One project, as a card. US-273.
 *
 * The first shared component that is not a primitive, and it is here for the
 * reason the words are: both applications show a list of projects, the card was
 * written twice, and the difference between the two copies was found by a
 * person looking at both screens rather than by anything failing.
 *
 * **The product's answers are slots, not branches.** The hosted product is one
 * monitor per project, so its status line is that monitor's state and its
 * second action opens it; self-hosted a project holds several, so the status is
 * a count and the action makes the next one. Neither is in here. What is in
 * here is the shape: the avatar, the identity, the description, the line above
 * the audience, the quiet pill that opens the inbox, and the question that
 * takes the action row when somebody presses Delete.
 *
 * **It holds no state.** `confirming` is a prop, so the page keeps deciding
 * which card is asking — two cards asking at once is a list where a person has
 * to read twice to see what they are about to delete.
 *
 * It renders the `<li>`. The list around it — one column or two, and its
 * heading — is the page's layout and stays there.
 *
 * **It links with the router, so it takes one as a peer.** A card whose name
 * is a plain anchor reloads the whole application on a click and loses
 * everything the screen held. Both applications ship the same router; this
 * package names it a peer and never a dependency, for React's reason — two
 * routers in one bundle is two histories.
 */
export interface ProjectCardProps {
  readonly name: string;
  /** Where the name and the pill lead: this project's inbox, as a route. */
  readonly inboxHref: string;
  /** What the business sells, in its own words. Clamped to two lines. */
  readonly product: string;
  /** Who it is for. Clamped to two lines under a label. */
  readonly audience: string;
  /** The label above it. Both products say the same thing today. */
  readonly audienceLabel?: string;
  /**
   * The line under the name: a monitor count, or one monitor's state.
   *
   * The card draws the dot in front of it; `statusTone` is what colours it.
   */
  readonly status: ReactNode;
  readonly statusTone?: "running" | "waiting" | "paused";
  /** The editor, when there is one to open. A legacy row may have none. */
  readonly editHref?: string;
  /** The application's own second action, beside the inbox pill. */
  readonly actions?: ReactNode;
  /**
   * What the delete takes, as a sentence. It names the rows that go, because
   * "Delete Acme QA?" does not say that every match goes with it.
   */
  readonly deleteQuestion: string;
  readonly confirming: boolean;
  readonly deleting: boolean;
  readonly onAskDelete: () => void;
  readonly onKeep: () => void;
  readonly onDelete: () => void;
}

export function ProjectCard({
  name,
  inboxHref,
  product,
  audience,
  audienceLabel = "Ideal customer",
  status,
  statusTone,
  editHref,
  actions,
  deleteQuestion,
  confirming,
  deleting,
  onAskDelete,
  onKeep,
  onDelete,
}: ProjectCardProps) {
  return (
    <li className="project-row">
      <div className="project-card-heading">
        <span className="project-avatar" aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="project-identity">
          <h2 className="project-name">
            <Link to={inboxHref}>{name}</Link>
          </h2>
          <small className={statusTone ? `project-count ${statusTone}` : "project-count"}>
            {status}
          </small>
        </div>
        {editHref && (
          <Link aria-label={`Edit ${name}`} className="project-edit-button" to={editHref}>
            Edit
          </Link>
        )}
      </div>

      <p className="project-product">{product}</p>

      <div className="project-audience">
        <span>{audienceLabel}</span>
        <p>{audience}</p>
      </div>

      <div className="project-actions">
        {/*
          Asked once, in place, and it replaces the navigation actions while it
          is open: on a narrow card two rows of unrelated controls compete for
          space, and a long project name wraps the question under the buttons
          it is about.
        */}
        {confirming ? (
          <div className="project-delete-confirm">
            <span>{deleteQuestion}</span>
            <div className="project-delete-confirm-actions">
              <button
                className="project-delete-keep"
                type="button"
                disabled={deleting}
                onClick={onKeep}
              >
                Keep
              </button>
              <button
                className="project-delete"
                type="button"
                disabled={deleting}
                onClick={onDelete}
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <Link className="project-open-button" to={inboxHref}>
              Open inbox
            </Link>
            {actions}
            <button className="project-delete" type="button" onClick={onAskDelete}>
              Delete
            </button>
          </>
        )}
      </div>
    </li>
  );
}
