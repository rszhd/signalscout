import { type FormEvent, useState } from "react";
import { codeFor, messageFor, requestJson } from "./api.js";
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
  /**
   * Whether this account has finished setting up. US-105.
   *
   * An account that completed setup once is never sent back to the setup
   * screen, however many keys it removes later.
   */
  readonly onboarded: boolean;
  /** Whether this instance charges for itself. US-072. */
  readonly billingMode: "off" | "stripe";
}

/**
 * The rule the server enforces, said before somebody types seven characters.
 *
 * A copy, and `packages/core/src/auth/auth.ts` holds the original — the bundle
 * cannot import core. The server is the one that refuses, so this number being
 * wrong shows up as a form that submits and comes back with an error, not as a
 * password shorter than the rule.
 */
export const minimumPasswordLength = 8;

/**
 * What a failed link says. US-092.
 *
 * Better Auth answers a bad `/api/auth/verify-email` by sending the browser
 * back to this screen with `?error=<CODE>`, so this is the only place in the
 * product that reads its error codes rather than its sentences. The codes are
 * short and mean nothing to a person; each one here is turned into the action
 * it implies, and an unknown code falls back to the one action that always
 * works.
 */
export function verificationFailure(code: string): string {
  if (code === "TOKEN_EXPIRED") {
    return "That confirmation link has expired. Sign in below and we will send a new one.";
  }
  if (code === "INVALID_TOKEN") {
    return "That confirmation link is not valid. Sign in below and we will send a new one.";
  }
  if (code === "USER_NOT_FOUND") {
    return "That confirmation link is for an account that no longer exists.";
  }

  return "That confirmation link did not work. Sign in below and we will send a new one.";
}

/** The `?error=` a verification redirect left in the address, if any. */
function verificationErrorInAddress(): string | null {
  return new URLSearchParams(globalThis.location?.search ?? "").get("error");
}

/** What the sign-up route answers. `token` is null when a link was sent instead. */
interface SignUpAnswer {
  readonly token: string | null;
}

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
  const [error, setError] = useState<string | null>(() => {
    const code = verificationErrorInAddress();
    return code ? verificationFailure(code) : null;
  });
  /**
   * The address a link has just been sent to, or null. US-092.
   *
   * A state of this screen rather than an address of its own, because there is
   * nothing at that address to come back to: the next thing that happens is a
   * person opening their mail on whatever device is nearest, and a bookmarkable
   * "we sent it" page is a page that lies the second time it is opened.
   */
  const [sentTo, setSentTo] = useState<string | null>(null);

  const signingUp = firstRun || (signUpOpen && registering);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const answer = await requestJson<SignUpAnswer>(
        `/api/auth/${signingUp ? "sign-up" : "sign-in"}/email`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(signingUp ? { name, email, password } : { email, password }),
        },
      );

      /**
       * A sign-up that made no session sent a link instead. US-092.
       *
       * Where the instance verifies addresses, this route answers `token: null`
       * and sets no cookie, so reloading would drop the person back on this
       * form with nothing said. The same answer comes back for an address that
       * is *already registered*, and that is deliberate on the server's side:
       * telling a stranger which addresses exist is the enumeration the setting
       * is there to stop. One sentence covers both, and it is true of both.
       */
      if (signingUp && answer?.token === null) {
        setSentTo(email);
        setBusy(false);
        return;
      }

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
      /**
       * An unverified sign-in is not a failed sign-in. US-092.
       *
       * The server refuses it and sends a fresh link on the way out, so the
       * honest answer is the same panel a new registration gets. The code is
       * what this reads, not the sentence beside it: the wording is the auth
       * library's and it may change with a version bump.
       */
      if (codeFor(cause) === "EMAIL_NOT_VERIFIED") {
        setSentTo(email);
        setBusy(false);
        return;
      }

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
          <p className="login-story-footer">Your accounts. Your API keys. Your data.</p>
        </aside>

        {sentTo ? (
          /*
            Where the person goes next is their inbox, so this replaces the
            form rather than sitting above it. Leaving the fields on screen
            would invite a second submit, which posts the same registration
            again and sends a second link.
          */
          <section className="login-card" aria-labelledby="login-title">
            <p className="login-eyebrow">One more step</p>
            <h1 id="login-title">Check your email</h1>
            <p className="page-subtitle">
              We sent a confirmation link to <strong>{sentTo}</strong>. Open it to finish signing
              in. The link works for 24 hours.
            </p>
            {/*
              The second sentence is the one that matters, and it is here
              because a person met this screen and read it as the product
              being broken.

              This panel is shown for an address that is *already registered*
              as well as for a new one — the server answers both the same way
              on purpose, so that a stranger cannot learn which addresses exist
              here. The cost of that is a person who forgot they had an
              account, registering again, waiting for mail that will never come,
              and having nothing on the screen to suggest otherwise. Naming the
              possibility leaks nothing: it is true of every address, and it is
              the one way out of the loop.
            */}
            <p className="login-note">
              Nothing arrived? Look in the spam folder. If you already have an account with this
              address, no link is sent — sign in instead. Signing in also sends a new link if you
              still need one.
            </p>
            <p className="login-switch">
              <button
                type="button"
                onClick={() => {
                  setSentTo(null);
                  setRegistering(false);
                  setPassword("");
                  setError(null);
                }}
              >
                Back to sign in
              </button>
            </p>
          </section>
        ) : (
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
        )}
      </div>
      <footer className="login-footer">Open-source AI intent monitoring.</footer>
    </main>
  );
}
