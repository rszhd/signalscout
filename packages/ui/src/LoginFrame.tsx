import type { ReactNode } from "react";
import { BrandLogo } from "./BrandLogo.js";

/**
 * The page around a sign-in form: the brand, the story beside the form, and
 * a footer. US-354.
 *
 * The form is the child, and it is each application's: first run and open
 * sign-up self-hosted, a password reset hosted. What the two products say
 * about themselves is a prop — `storyNote` under the story's points, and the
 * `footer` line.
 */
export interface LoginFrameProps {
  readonly children: ReactNode;
  readonly storyNote?: ReactNode;
  readonly footer?: ReactNode;
}

export function LoginFrame({
  children,
  storyNote,
  footer = "AI intent monitoring.",
}: LoginFrameProps) {
  return (
    <main className="login-page">
      <header className="login-header">
        <div className="login-brand">
          <BrandLogo />
          <span>SignalScout</span>
        </div>
        <span className="login-header-note">Conversations worth finding.</span>
      </header>

      <div className="login-layout">
        <aside className="login-story" aria-labelledby="login-story-title">
          <p className="login-eyebrow">A little less searching. A lot more signal.</p>
          <h2 id="login-story-title">
            Your next customer
            <br />
            is already talking.
          </h2>
          <p className="login-story-copy">
            Find people describing the problem your product solves, and join the conversation when
            it matters.
          </p>
          <ul className="login-story-points">
            <li>
              <span aria-hidden="true">01</span>
              <p>
                <strong>Find real demand</strong>
                <span>Watch public conversations where customers already ask for help.</span>
              </p>
            </li>
            <li>
              <span aria-hidden="true">02</span>
              <p>
                <strong>Read for intent</strong>
                <span>Bring the conversations most relevant to your product into one inbox.</span>
              </p>
            </li>
            <li>
              <span aria-hidden="true">03</span>
              <p>
                <strong>Stay in control</strong>
                <span>You choose when to reply. SignalScout never posts for you.</span>
              </p>
            </li>
          </ul>
          {storyNote && <p className="login-story-footer">{storyNote}</p>}
        </aside>

        {children}
      </div>
      <footer className="login-footer">{footer}</footer>
    </main>
  );
}
