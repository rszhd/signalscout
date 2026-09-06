import { useCallback, useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";
import { BrandIcon } from "./BrandIcon.js";

/**
 * Where a provider key is pasted, tested and stored.
 *
 * Correctness-critical: credential encryption. US-010 refused to validate a
 * key on the monitor form and said why: the answer belongs next to the field a
 * person pastes into, and a resume that made a network call would be refused
 * by a provider outage that has nothing to do with the key. This is that
 * place.
 *
 * Three things on this screen are decisions, not layout.
 *
 * **The environment variable is shown beside every field.** Setting a key in
 * `.env` stays supported, and it is what every existing deployment does. A
 * screen that offered only the database would make a working instance look
 * unconfigured.
 *
 * **A key from the environment has no remove button.** There is no row to
 * delete, so the button would call a route that answers 404. The variable's
 * name is the action instead.
 *
 * **Testing is offered even when storing is not.** The probe costs nothing and
 * writes nothing, so an instance with no `ENCRYPTION_KEY` can still check the
 * key it has in its environment.
 *
 * US-026 added the second half of the screen: which provider fetches which
 * platform. It is here and not on the monitor form, because the choice is one
 * a person makes once for every monitor, and because a form asking where to
 * listen must not also ask which scraper to pay. The rows appear only for a
 * platform this build fetches two ways, so the deployment holding one key sees
 * nothing new.
 */

interface CredentialView {
  name: string;
  label: string;
  environmentVariable: string;
  /** `••••1234`, or null. Never the key. */
  storedHint: string | null;
  fromEnvironment: boolean;
  configured: boolean;
}

interface ProviderView {
  id: string;
  displayName: string;
  /** The platforms this one key unlocks: "Reddit". */
  platforms: string[];
  ready: boolean;
  credentials: CredentialView[];
}

/** One platform, and which of its providers fetches it. */
interface PlatformView {
  id: string;
  displayName: string;
  providers: { id: string; displayName: string; connected: boolean }[];
  /** The recorded choice, or null when nobody has made one. */
  chosen: string | null;
  /** Who would fetch it on the next collection, or null when nothing can. */
  effective: string | null;
  /** True when two providers could run it and nobody has chosen. */
  needsChoice: boolean;
  /** Null while the platform can be collected. Otherwise the sentence why not. */
  blocker: string | null;
}

interface ConnectionsView {
  canStore: boolean;
  storeBlocker: string | null;
  providers: ProviderView[];
  platforms: PlatformView[];
}

type LoadState = "loading" | "ready" | "error";

/** What a test or a save last said about one provider. */
interface Answer {
  tone: "good" | "bad";
  text: string;
}

// Official account websites. Unknown providers remain plain text.
const providerWebsites: Record<string, string> = {
  brightdata: "https://brightdata.com/",
  scrapecreators: "https://scrapecreators.com/",
  socialcrawl: "https://www.socialcrawl.dev/",
};

function ConnectionsHeader() {
  return (
    <header className="topbar">
      <div>
        <h1>Connections</h1>
        <p className="page-subtitle">
          Connect your accounts. Choose where conversations come from.
        </p>
      </div>
    </header>
  );
}

/** Where this field's key comes from, in the words a person can act on. */
function origin(credential: CredentialView): string {
  if (credential.storedHint) return `Stored in this instance · ${credential.storedHint}`;
  if (credential.fromEnvironment) return `Set in ${credential.environmentVariable}`;

  return "Not connected";
}

function ProviderCard({
  provider,
  canStore,
  onChanged,
}: {
  provider: ProviderView;
  canStore: boolean;
  onChanged: (provider: ProviderView) => void;
}) {
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);

  /** Only the fields somebody actually filled in reach the server. */
  function filled(): Record<string, string> {
    return Object.fromEntries(Object.entries(typed).filter(([, value]) => value.trim()));
  }

  async function test(): Promise<void> {
    setBusy(true);
    setAnswer(null);

    try {
      const result = await requestJson<{ valid: boolean; reason: string | null }>(
        `/api/connections/${provider.id}/test`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The key travels in the body. A query string would put it in the
          // access log, the browser history and every proxy between.
          body: JSON.stringify({ credentials: filled() }),
        },
      );

      setAnswer(
        result.valid
          ? { tone: "good", text: `${provider.displayName} accepted this key.` }
          : { tone: "bad", text: result.reason ?? `${provider.displayName} refused this key.` },
      );
    } catch (cause) {
      // The server's own sentence. A provider that could not be reached says
      // to try again; a refusal says the key is wrong. The screen must not
      // flatten the two into "request failed".
      setAnswer({ tone: "bad", text: messageFor(cause, "The key could not be tested.") });
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setAnswer(null);

    try {
      const updated = await requestJson<ProviderView>(`/api/connections/${provider.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentials: filled() }),
      });

      // Cleared only on success. A refused key stays on the screen, because a
      // person who mistyped one character should fix that character rather
      // than fetch the key again.
      setTyped({});
      setAnswer({ tone: "good", text: `${provider.displayName} is connected.` });
      onChanged(updated);
    } catch (cause) {
      setAnswer({ tone: "bad", text: messageFor(cause, "The key could not be saved.") });
    } finally {
      setBusy(false);
    }
  }

  async function remove(field: CredentialView): Promise<void> {
    setBusy(true);
    setAnswer(null);

    try {
      onChanged(
        await requestJson<ProviderView>(`/api/connections/${provider.id}/${field.name}`, {
          method: "DELETE",
        }),
      );
    } catch (cause) {
      setAnswer({ tone: "bad", text: messageFor(cause, "The key could not be removed.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="connection-row">
      <details className="connection-account">
        <summary className="connection-summary">
          <span className="connection-avatar" aria-hidden="true">
            <BrandIcon brand={provider.id} size={26} />
          </span>
          <span className="connection-identity">
            <strong>
              {providerWebsites[provider.id] ? (
                <a
                  className="connection-website"
                  href={providerWebsites[provider.id]}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${provider.displayName} website (opens in a new tab)`}
                >
                  {provider.displayName}{" "}
                  <span className="connection-external" aria-hidden="true">
                    ↗
                  </span>
                </a>
              ) : (
                provider.displayName
              )}
            </strong>
            <span className="connection-platforms">
              {provider.platforms.map((platform) => (
                <span className="brand-label" key={platform}>
                  <BrandIcon brand={platform} size={16} />
                  {platform}
                </span>
              ))}
            </span>
            {provider.ready && <small>{provider.credentials.map(origin).join(" · ")}</small>}
          </span>
          <span className={`connection-status ${provider.ready ? "connected" : "missing"}`}>
            {provider.ready ? "Connected" : "Not connected"}
          </span>
          <span className="connection-expand">
            {provider.ready ? "Manage" : "Connect"}
            <span aria-hidden="true">⌄</span>
          </span>
        </summary>
        <div className="connection-editor">
          <p className="connection-editor-note">
            {provider.ready
              ? "Test the current connection or paste a replacement key."
              : "Paste your provider key to connect this account."}{" "}
            Keys are tested before saving.
          </p>
          {provider.credentials.map((credential) => (
            <div key={credential.name} className="connection-field">
              <label className="field">
                <span>{credential.label}</span>
                <small className="connection-origin">{origin(credential)}</small>
                <input
                  aria-label={`${credential.label} for ${provider.displayName}`}
                  // The browser must not offer this back on another screen, and a
                  // key on a shared screen must not be readable over a shoulder.
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  placeholder={
                    credential.configured ? "Paste a new key to replace it" : "Paste the key"
                  }
                  value={typed[credential.name] ?? ""}
                  onChange={(event) => {
                    setAnswer(null);
                    setTyped((current) => ({ ...current, [credential.name]: event.target.value }));
                  }}
                />
              </label>

              <p className="connection-hint">
                Or set <code>{credential.environmentVariable}</code> in this instance's environment
                and restart.
              </p>

              {credential.storedHint && (
                <button
                  type="button"
                  className="text-button remove-key"
                  disabled={busy}
                  onClick={() => void remove(credential)}
                >
                  Remove stored key
                </button>
              )}
            </div>
          ))}

          <div className="connection-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void test()}
            >
              Test connection
            </button>
            {canStore && (
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => void save()}
              >
                Save key
              </button>
            )}
          </div>
        </div>
      </details>

      {answer && (
        <p
          className={answer.tone === "good" ? "connection-answer good" : "budget-error"}
          role={answer.tone === "good" ? "status" : "alert"}
        >
          {answer.text}
        </p>
      )}
    </li>
  );
}

/**
 * One row per platform, showing who fetches it.
 *
 * The row is hidden entirely when a platform has one provider in the build:
 * there is no question, so there is nothing to show, and a row that said
 * "Reddit is fetched by Bright Data, and that is your only option" would be
 * furniture. US-026 is firm that the common deployment sees no choice at all.
 *
 * The buttons are radios and not a dropdown. Two options is a comparison, and
 * a person deciding which account pays should be able to read both without
 * opening anything.
 */
function PlatformRow({
  platform,
  onChanged,
}: {
  platform: PlatformView;
  onChanged: (view: ConnectionsView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(providerId: string | null): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      onChanged(
        await requestJson<ConnectionsView>(`/api/platforms/${platform.id}/provider`, {
          method: providerId === null ? "DELETE" : "PUT",
          ...(providerId === null
            ? {}
            : {
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ provider: providerId }),
              }),
        }),
      );
    } catch (cause) {
      setError(messageFor(cause, "The choice could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  const effective = platform.providers.find((provider) => provider.id === platform.effective);

  return (
    <li className="connection-row">
      <details className="platform-connection" open={platform.needsChoice || !!platform.blocker}>
        <summary className="connection-summary">
          <span className="connection-avatar" aria-hidden="true">
            <BrandIcon brand={platform.id} size={24} />
          </span>
          <span className="connection-identity">
            <strong>{platform.displayName}</strong>
            <span>
              {effective ? `Fetched by ${effective.displayName}` : "Nothing is fetching this yet"}
            </span>
          </span>
          <span className={`connection-status ${effective ? "connected" : "missing"}`}>
            {effective ? "Ready" : platform.needsChoice ? "Choose one" : "Unavailable"}
          </span>
          <span className="connection-expand">
            Change<span aria-hidden="true">⌄</span>
          </span>
        </summary>
        <div className="connection-editor">
          <fieldset className="provider-choice">
            <legend className="visually-hidden">Provider for {platform.displayName}</legend>
            {platform.providers.map((provider) => (
              <label
                className={provider.connected ? "provider-option" : "provider-option unavailable"}
                key={provider.id}
              >
                <input
                  checked={platform.chosen === provider.id}
                  disabled={busy || !provider.connected}
                  name={`provider-for-${platform.id}`}
                  type="radio"
                  onChange={() => void choose(provider.id)}
                />
                <span>
                  <strong>{provider.displayName}</strong>
                  <small>{provider.connected ? "Connected" : "No key here"}</small>
                </span>
              </label>
            ))}
          </fieldset>

          {platform.blocker && (
            <p className="connection-hint" role="status">
              {platform.blocker}
            </p>
          )}

          {platform.chosen && (
            <button
              type="button"
              className="text-button remove-key"
              disabled={busy}
              // Not a disconnect. The keys stay; the platform simply goes back to
              // answering by itself whenever one provider can run.
              onClick={() => void choose(null)}
            >
              Clear this choice
            </button>
          )}

          {error && (
            <p className="budget-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </details>
    </li>
  );
}

export function Connections() {
  const [view, setView] = useState<ConnectionsView | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setView(await requestJson<ConnectionsView>("/api/connections"));
      setState("ready");
    } catch (cause) {
      setError(messageFor(cause, "The connections could not be loaded."));
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Replace one provider with what the write returned, rather than reloading.
   *
   * The routes answer with the provider's own refreshed view, so a reload
   * would be a second round trip for an answer already in hand.
   */
  function replace(updated: ProviderView): void {
    setView((current) =>
      current
        ? {
            ...current,
            providers: current.providers.map((provider) =>
              provider.id === updated.id ? updated : provider,
            ),
          }
        : current,
    );
  }

  if (state === "loading") {
    return (
      <div className="product-page connections-page">
        <ConnectionsHeader />
        <div className="center-state page-state" role="status">
          <div className="spinner" aria-hidden="true" />
          <p>Reading your connections.</p>
        </div>
      </div>
    );
  }

  if (state === "error" || !view) {
    return (
      <div className="product-page connections-page">
        <ConnectionsHeader />
        <div className="center-state page-state" role="alert">
          <h2>The connections could not be loaded</h2>
          <p>{error}</p>
          <button type="button" className="primary-button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  // Only a platform the build fetches two ways has a question to answer. With
  // one provider there is nothing to choose, and a row saying so is furniture.
  const choosable = view.platforms.filter((platform) => platform.providers.length > 1);

  return (
    <div className="product-page connections-page">
      <ConnectionsHeader />

      <div className="connections-content">
        <section className="connections-section" aria-labelledby="accounts-heading">
          <div className="connections-section-heading">
            <div>
              <h2 id="accounts-heading">Provider accounts</h2>
              <p>
                One provider account can connect several platforms. Connect only the ones you need.
              </p>
            </div>
            <span>
              {view.providers.filter((provider) => provider.ready).length} of{" "}
              {view.providers.length} connected
            </span>
          </div>
          {!view.canStore && (
            <div className="notice warning" role="status">
              <strong>Key storage needs setup</strong>
              <span>{view.storeBlocker}</span>
            </div>
          )}

          <ul className="connection-list">
            {view.providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                canStore={view.canStore}
                onChanged={replace}
              />
            ))}
          </ul>

          {view.providers.length === 0 && (
            <div className="connections-empty" role="status">
              <h3>No providers available</h3>
              <p>This deployment has no provider accounts to configure.</p>
            </div>
          )}
        </section>
        {choosable.length > 0 && (
          <section className="connections-section" aria-labelledby="platforms-heading">
            <div className="connections-section-heading">
              <div>
                <h2 id="platforms-heading">Which provider fetches what</h2>
                <p>
                  Choose the account each platform uses. Changes apply to every monitor on its next
                  collection.
                </p>
              </div>
            </div>

            <ul className="connection-list">
              {choosable.map((platform) => (
                <PlatformRow key={platform.id} platform={platform} onChanged={setView} />
              ))}
            </ul>
            <p className="connections-footnote">
              Collections already running finish with the provider that started them.
            </p>
          </section>
        )}
        <details className="disclosure connections-help">
          <summary>How keys are stored</summary>
          <p>
            Saved keys are encrypted in this instance’s database. Only a masked hint is shown after
            saving. Environment variables remain supported; each account lists the variable to set.
          </p>
          <p>
            Connecting an account does not start a monitor. Choose platforms and a schedule when you
            create one.
          </p>
        </details>
      </div>
    </div>
  );
}
