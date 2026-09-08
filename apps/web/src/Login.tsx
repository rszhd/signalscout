import { type FormEvent, useState } from "react";
import { messageFor, requestJson } from "./api.js";
import { BrandLogo } from "./BrandLogo.js";

/** Email authentication, with registration offered only when the instance allows it. */

/** What `/api/auth-status` answers. */
export interface AuthStatus {
  /** No account exists yet, so this visit is the one that sets the instance up. */
  readonly firstRun: boolean;
  /** Somebody may register right now. Always true on the first run. US-066. */
  readonly signUpOpen: boolean;
  readonly signedIn: boolean;
  /** Who is asking, or null when nobody is signed in. US-069. */
  readonly account: { readonly name: string; readonly email: string } | null;
  /** Whether this instance charges for itself. US-072. */
  readonly billingMode: "off" | "stripe";
}

/**
 * The rule the server enforces, said before somebody types eleven characters.
 *
 * A copy, and `packages/core/src/auth/auth.ts` holds the original — the bundle
 * cannot import core. The server is the one that refuses, so this number being
 * wrong shows up as a form that submits and comes back with an error, not as a
 * password shorter than the rule.
 */
export const minimumPasswordLength = 12;

export function Login({ firstRun, signUpOpen }: { firstRun: boolean; signUpOpen: boolean }) {
  /**
   * Which form is on the screen.
   *
   * The first run has no choice to make — there is nobody to sign in as — so it
   * starts and stays on the sign-up form. After that the screen opens on sign
   * in, because on an instance taking registrations most visitors are people
   * coming back, and offers the way to a new account beside it.
   */
  const [registering, setRegistering] = useState(firstRun);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signingUp = firstRun || (signUpOpen && registering);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await requestJson(`/api/auth/${signingUp ? "sign-up" : "sign-in"}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signingUp ? { name, email, password } : { email, password }),
      });

      /**
       * A reload rather than a state change.
       *
       * Every screen behind this one loads on mount, and the session cookie
       * only exists as of this response. Reloading is one line and it cannot
       * leave a screen holding data it fetched while signed out — which is the
       * empty inbox a person would otherwise meet on the way in.
       */
      globalThis.location.reload();
    } catch (cause) {
      setError(messageFor(cause, "That did not work. Try again."));
      setBusy(false);
    }
  }

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
          <figure className="login-preview">
            <figcaption>Example conversation</figcaption>
            <div className="login-preview-heading">
              <span className="login-preview-source">Reddit · r/SaaS</span>
              <span className="login-signal">Asking for recommendations</span>
            </div>
            <blockquote>
              “We’re only three developers and manually test signup and checkout before every
              release. What are other small teams using?”
            </blockquote>
            <div className="login-preview-reason">
              <span className="login-preview-mark" aria-hidden="true">
                ↗
              </span>
              <p>
                <strong>A problem your product could solve.</strong>
                <span>A small team. A recurring pain. An active search for a solution.</span>
              </p>
            </div>
          </figure>
          <p className="login-story-footer">Your accounts. Your API keys. Your data.</p>
        </aside>

        <section className="login-card" aria-labelledby="login-title">
          <p className="login-eyebrow">{signingUp ? "Get started" : "Welcome back"}</p>
          <h1 id="login-title">
            {firstRun ? "Set up this instance" : signingUp ? "Create an account" : "Sign in"}
          </h1>
          <p className="page-subtitle">
            {firstRun
              ? "This instance has no account yet. The first one is yours, and signup closes behind it."
              : signingUp
                ? "Your monitors, matches and saved replies are your own."
                : "Sign in to read your inbox."}
          </p>

          <form className="field-stack" onSubmit={submit} aria-busy={busy}>
            {signingUp && (
              <label className="field">
                <span>Your name</span>
                <input
                  aria-label="Your name"
                  autoComplete="name"
                  placeholder="Alex Morgan"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            )}

            <label className="field">
              <span>Email</span>
              <input
                aria-label="Email"
                autoComplete="username"
                placeholder="you@company.com"
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                aria-label="Password"
                autoComplete={signingUp ? "new-password" : "current-password"}
                placeholder={signingUp ? "Create a password" : "Enter your password"}
                aria-describedby={signingUp ? "login-password-help" : undefined}
                minLength={signingUp ? minimumPasswordLength : undefined}
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {signingUp && (
                <small id="login-password-help">
                  Use at least {minimumPasswordLength} characters.
                </small>
              )}
            </label>

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <button className="primary-button" disabled={busy} type="submit">
              {busy ? "Working…" : signingUp ? "Create the account" : "Sign in"}
            </button>
          </form>

          {/*
          Only where a second account is actually possible. On a closed instance
          this is absent rather than disabled: an offer that refuses is worse
          than no offer, because somebody will fill the form in first.
        */}
          {!firstRun && signUpOpen && (
            <p className="login-switch">
              {registering ? "Already have an account? " : "New here? "}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRegistering(!registering);
                  setError(null);
                }}
              >
                {registering ? "Sign in" : "Create an account"}
              </button>
            </p>
          )}

          {firstRun && (
            <p className="login-note">
              Put this instance behind TLS before you open it to the internet. It holds provider
              keys that spend money.
            </p>
          )}
        </section>
      </div>
      <footer className="login-footer">Open-source AI intent monitoring.</footer>
    </main>
  );
}
