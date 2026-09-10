import type { ReactNode } from "react";
import { Button } from "./Button.js";

/**
 * A shared modal dialog. US-099.
 *
 * This is the single path to a dialog. The screens each build their own
 * heading content and their own body, but the shell is the same: a native
 * `<dialog>`, a heading row with a Close button, and `aria-labelledby` pointing
 * at the heading's title id. Before this existed a screen could reach for
 * `role="dialog"` on a div with a manual Escape listener (ReplyDraft), which is
 * a different modal with different focus behaviour.
 *
 * `dialogRef` is the `<dialog>` element. A caller opens it with
 * `dialogRef.current?.showModal()` and closes it the same way, exactly as the
 * screens already do. The Close button stays a real button that closes the
 * dialog; `onClose` runs alongside for any state a screen resets.
 *
 * Classes are props because the theme styles the two dialogs separately
 * (`models-dialog`, `connection-dialog`). The dialog owns the *semantics*; the
 * page owns the *look*.
 */
export function Dialog({
  className,
  headingClass,
  titleId,
  closeLabel,
  heading,
  onClose,
  children,
  dialogRef,
}: {
  /** The dialog's own class, e.g. `models-dialog`. */
  readonly className?: string;
  /** The heading row's class, e.g. `models-dialog-heading`. */
  readonly headingClass?: string;
  /** The id of the heading's title element, for `aria-labelledby`. */
  readonly titleId: string;
  /** What the Close button says to a screen reader. */
  readonly closeLabel: string;
  /** The heading content, beside the Close button. */
  readonly heading: ReactNode;
  /** Runs when the dialog closes, after `close()`. */
  readonly onClose?: () => void;
  /** The dialog body. */
  readonly children: ReactNode;
  /** The `<dialog>` element, for `showModal()` and `close()`. */
  readonly dialogRef: { current: HTMLDialogElement | null };
}) {
  return (
    <dialog
      className={className ? `app-dialog ${className}` : "app-dialog"}
      ref={dialogRef}
      aria-labelledby={titleId}
    >
      <header
        className={headingClass ? `app-dialog-heading ${headingClass}` : "app-dialog-heading"}
      >
        {heading}
        <Button
          variant="compact"
          aria-label={closeLabel}
          onClick={() => {
            dialogRef.current?.close();
            onClose?.();
          }}
        >
          Close
        </Button>
      </header>
      {children}
    </dialog>
  );
}
