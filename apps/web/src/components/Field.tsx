import type { ReactNode } from "react";

/**
 * A labelled field. US-099.
 *
 * The shape a form control is wrapped in: a `label.field` with a `<span>` for
 * the visible prompt, an optional `<small>` for supporting text, and the
 * control itself as children. Before this existed every screen wrote
 * `className="field"` and the span by hand, about thirty times.
 *
 * The label wraps the control, so a person tapping the field focuses it and a
 * screen reader reads the prompt with it. A screen that needs a different
 * relation passes `controlId` and puts the class on the children.
 */
export function Field({
  children,
  label,
  hint,
  className,
  controlId,
}: {
  readonly children: ReactNode;
  /** The visible prompt. */
  readonly label: string;
  /** Supporting text under the prompt. */
  readonly hint?: ReactNode;
  /** An extra class on the label, e.g. a page's own field class. */
  readonly className?: string;
  /** When set, the label targets the control by id instead of wrapping it. */
  readonly controlId?: string;
}) {
  return (
    <label className={className ? `field ${className}` : "field"} htmlFor={controlId}>
      <span>{label}</span>
      {hint && <small>{hint}</small>}
      {children}
    </label>
  );
}
