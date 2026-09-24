import type { ReactNode } from "react";
import { BrandLogo } from "./BrandLogo.js";

/**
 * The page around a sign-in form, in the shape of Google's own sign-in: one
 * wide card with the mark at its top, the screen's heading on the left and
 * its form on the right. US-354. On a phone the card is the page, in one
 * column.
 *
 * The screen is the child, and it is each application's: first run and open
 * sign-up self-hosted, a password reset hosted. Each screen is a
 * `.login-card` holding a `.login-head` and a `.login-body`, and ends its
 * form with a `.login-actions` row. What a product says about itself —
 * `storyNote`, `footer` — sits in a small row under the card, and only when
 * it passes one.
 */
export interface LoginFrameProps {
  readonly children: ReactNode;
  readonly storyNote?: ReactNode;
  readonly footer?: ReactNode;
}

export function LoginFrame({ children, storyNote, footer }: LoginFrameProps) {
  return (
    <main className="login-page">
      <div className="login-column">
        <div className="login-shell">
          <BrandLogo />
          {children}
        </div>
        {(storyNote || footer) && (
          <footer className="login-footer">
            {storyNote && <span className="login-story-footer">{storyNote}</span>}
            {footer}
          </footer>
        )}
      </div>
    </main>
  );
}
