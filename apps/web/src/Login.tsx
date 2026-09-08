import { type FormEvent, useState } from "react";
import { messageFor, requestJson } from "./api.js";
import { BrandLogo } from "./BrandLogo.js";

/**
 * The one screen a signed-out person can reach. US-017.
 *
 * It is two forms, and which one it shows is not a choice a person makes: an
 * instance with no account yet asks for one, and an instance that has one asks
 * to be let in. Offering both would put an open signup form on a public
 * address, which is the way these tools are usually given away.
 *
 * There is no "forgot password" and no "create another account". Nothing here
 * sends mail, so a reset link would be a button that does nothing; the recovery
 * path for a self-hoster is the database they already own, and
 * docs/self-hosting.md says which command.
 */

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
      <section className="login-card">
        <div className="login-brand">
          <BrandLogo />
          <span>SignalScout</span>
        </div>

        <h1>{firstRun ? "Set up this instance" : signingUp ? "Create an account" : "Sign in"}</h1>
        <p className="page-subtitle">
          {firstRun
            ? "This instance has no account yet. The first one is yours, and signup closes behind it."
            : signingUp
              ? "Your monitors, matches and saved replies are your own."
              : "Sign in to read your inbox."}
        </p>

        <form className="field-stack" onSubmit={submit}>
          {signingUp && (
            <label className="field">
              <span>Your name</span>
              <input
                aria-label="Your name"
                autoComplete="name"
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
              minLength={signingUp ? minimumPasswordLength : undefined}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {signingUp && (
              <small>
                At least {minimumPasswordLength} characters. Length is what a password costs
                somebody guessing it.
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
            Put this instance behind TLS before you open it to the internet. It holds provider keys
            that spend money.
          </p>
        )}
      </section>
    </main>
  );
}
