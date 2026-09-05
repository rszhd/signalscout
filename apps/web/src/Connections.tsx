import { useCallback, useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";

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

interface SourceView {
  id: string;
  displayName: string;
  ready: boolean;
  credentials: CredentialView[];
}

interface ConnectionsView {
  canStore: boolean;
  storeBlocker: string | null;
  sources: SourceView[];
}

type LoadState = "loading" | "ready" | "error";

/** What a test or a save last said about one source. */
interface Answer {
  tone: "good" | "bad";
  text: string;
}

function ConnectionsHeader() {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Providers</p>
        <h1>Connections</h1>
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

function SourceCard({
  source,
  canStore,
  onChanged,
}: {
  source: SourceView;
  canStore: boolean;
  onChanged: (source: SourceView) => void;
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
        `/api/connections/${source.id}/test`,
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
          ? { tone: "good", text: `${source.displayName} accepted this key.` }
          : { tone: "bad", text: result.reason ?? `${source.displayName} refused this key.` },
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
      const updated = await requestJson<SourceView>(`/api/connections/${source.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentials: filled() }),
      });

      // Cleared only on success. A refused key stays on the screen, because a
      // person who mistyped one character should fix that character rather
      // than fetch the key again.
      setTyped({});
      setAnswer({ tone: "good", text: `${source.displayName} is connected.` });
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
        await requestJson<SourceView>(`/api/connections/${source.id}/${field.name}`, {
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
    <li className="monitor-card">
      <div className="monitor-top">
        <div className="monitor-identity">
          <span className="product-icon" aria-hidden="true">
            {source.displayName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h2>{source.displayName}</h2>
            <p className="monitor-origin">
              {source.credentials.length === 1 ? "One key" : `${source.credentials.length} keys`} ·
              tested with the provider before it is saved
            </p>
          </div>
        </div>
        <span className={`monitor-status ${source.ready ? "running" : "stopped"}`}>
          {source.ready ? "Connected" : "Needs a key"}
        </span>
      </div>

      {source.credentials.map((credential) => (
        <div key={credential.name} className="connection-field">
          <label className="field">
            <span>{credential.label}</span>
            <small className="connection-origin">{origin(credential)}</small>
            <input
              aria-label={`${credential.label} for ${source.displayName}`}
              // The browser must not offer this back on another screen, and a
              // key on a shared screen must not be readable over a shoulder.
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={
                credential.configured ? "Paste a new key to replace it" : "Paste the key"
              }
              value={typed[credential.name] ?? ""}
              onChange={(event) =>
                setTyped((current) => ({ ...current, [credential.name]: event.target.value }))
              }
            />
          </label>

          <p className="connection-hint">
            Or set <code>{credential.environmentVariable}</code> in this instance's environment and
            restart.
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

      <div className="monitor-card-actions">
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
   * Replace one source with what the write returned, rather than reloading.
   *
   * The routes answer with the source's own refreshed view, so a reload would
   * be a second round trip for an answer already in hand.
   */
  function replace(updated: SourceView): void {
    setView((current) =>
      current
        ? {
            ...current,
            sources: current.sources.map((source) => (source.id === updated.id ? updated : source)),
          }
        : current,
    );
  }

  if (state === "loading") {
    return (
      <div className="product-page monitors-page">
        <ConnectionsHeader />
        <div className="center-state page-state">
          <div className="spinner" aria-hidden="true" />
          <p>Reading your connections.</p>
        </div>
      </div>
    );
  }

  if (state === "error" || !view) {
    return (
      <div className="product-page monitors-page">
        <ConnectionsHeader />
        <div className="center-state page-state">
          <h2>The connections could not be loaded</h2>
          <p>{error}</p>
          <button type="button" className="primary-button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="product-page monitors-page">
      <ConnectionsHeader />

      <div className="section-intro">
        <p>
          A key is tested with the provider before it is saved, so a monitor never starts on a key
          that does not work. A saved key is encrypted in this instance's database and is never
          shown again.
        </p>
      </div>

      {!view.canStore && (
        <div className="notice warning">
          <span>{view.storeBlocker}</span>
        </div>
      )}

      <ul className="monitor-list">
        {view.sources.map((source) => (
          <SourceCard
            key={source.id}
            source={source}
            canStore={view.canStore}
            onChanged={replace}
          />
        ))}
      </ul>
    </div>
  );
}
