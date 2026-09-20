import type { ReactNode } from "react";

/**
 * A refusal, in the server's own sentence. US-276.
 *
 * Every form and every list shows one when a request fails, and every one is
 * `role="alert"`, because a refusal is the thing a person did not ask for and a
 * screen reader must say it without being asked. Written by hand nineteen
 * times here and eleven times hosted before this; the role was on all of
 * them, which is luck rather than a rule.
 *
 * With an `action` it is a row — the sentence and a retry — and without one it
 * is a line. A `className` is for a placement the page owns, such as a notice
 * that floats over a list; the look is not the page's to change.
 */
export interface FormErrorProps {
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function FormError({ children, action, className }: FormErrorProps) {
  const classes = className ? `form-error ${className}` : "form-error";

  if (action === undefined) {
    return (
      <p className={classes} role="alert">
        {children}
      </p>
    );
  }

  return (
    <div className={classes} role="alert">
      <span>{children}</span>
      {action}
    </div>
  );
}
