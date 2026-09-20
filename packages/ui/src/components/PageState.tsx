import type { ReactNode } from "react";

/**
 * What a screen says while it waits, when it has nothing, and when the server
 * refused. US-276.
 *
 * It was written by hand on nearly every screen in both applications — a mark,
 * a heading, a sentence, sometimes an action — and the copies disagreed in the
 * small ways fifty-eight copies do: a spinner that was a `div` here and a
 * `span` there, an error with an icon on one screen and none on the next, and
 * `role` remembered on some and forgotten on others. The role is the part that
 * matters to a screen reader, and the part a screen cannot be trusted to
 * remember, so it is the one thing this decides and a caller cannot change.
 *
 * `loading` and `empty` are `status`: the screen is telling the person where
 * it is. `error` is `alert`: something happened that they did not ask for.
 */
export interface PageStateProps {
  readonly kind: "loading" | "empty" | "error";
  readonly heading?: ReactNode;
  /** The sentence. A loading state usually has only this. */
  readonly children?: ReactNode;
  /** A glyph for an empty state. Loading draws a spinner and error a `!`. */
  readonly mark?: ReactNode;
  /** One thing to press: a retry, a way out, a first step. */
  readonly action?: ReactNode;
  /**
   * Whether it fills the page. False for a notice inside a screen that is
   * otherwise fine — an address that names nothing, a form whose options did
   * not arrive — where a page's worth of empty space would be the wrong claim.
   */
  readonly page?: boolean;
}

export function PageState({ kind, heading, children, mark, action, page = true }: PageStateProps) {
  const classes = [
    "center-state",
    page ? "page-state" : null,
    kind === "error" ? "error-state" : null,
  ]
    .filter((one) => one !== null)
    .join(" ");

  return (
    <div className={classes} role={kind === "error" ? "alert" : "status"}>
      {kind === "loading" && <span className="spinner" aria-hidden="true" />}
      {kind === "error" && (
        <span className="state-icon" aria-hidden="true">
          !
        </span>
      )}
      {kind === "empty" && mark !== undefined && (
        <span className="empty-mark" aria-hidden="true">
          {mark}
        </span>
      )}
      {heading !== undefined && <h2>{heading}</h2>}
      {children !== undefined && <p>{children}</p>}
      {action}
    </div>
  );
}
