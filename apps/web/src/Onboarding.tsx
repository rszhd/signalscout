import { type FormEvent, useCallback, useState } from "react";
import { messageFor, requestJson } from "./api.js";
import { BrandIcon } from "./BrandIcon.js";
import { BrandLogo } from "./BrandLogo.js";

/**
 * The two keys a new account is asked for, before it is given the product.
 * US-088.
 *
 * A provider key buys the conversations and a model key reads them, so an
 * account holding neither can do nothing at all: no platform can be ticked, no
 * post can be collected and nothing can be scored.
 *
 * **This is a gate, not a route.** `App.tsx` renders it in place of the whole
 * application while either key is missing, exactly the way it renders the
 * login in place of the application while nobody is signed in. The first
 * version of this ticket made it a route the catch-all redirected to, with a
 * link out of it — so a new account could step around it in one click and then
 * meet the same missing key later, on the monitor form, as a refusal. That is
 * the failure this screen exists to prevent, so there is no way past it but to
 * paste the two keys or sign out.
 *
 * **It asks for one of each and nothing else.** Not every provider, not the
 * four model jobs, not a project and not a monitor. One of each is the
 * smallest state in which the product works; everything past it belongs on the
 * screen that owns it, and those screens are in the sidebar on the other side
 * of this one.
 *
 * **It stores nothing of its own.** The two saves are the routes Connections
 * and Models already use, so a key is tested with the provider before it is
 * stored and a refusal is the provider's own sentence, here as there. The
 * first model key becomes the account's default without being asked to, so
 * pointing a job at it is not part of setup.
 *
 * **Whether setup is finished is derived, not recorded.** There is no flag and
 * no migration: `App.tsx` reads the same two views the other screens read and
 * asks whether any provider is ready and whether the scoring job can run. A
 * stored flag would be a second copy of the truth that goes wrong in the
 * direction that hurts — an account that deleted its keys would be let in and
 * then refused by every poll. One wanted consequence falls out: an instance
 * whose keys are in `.env` is already finished, so nobody there ever sees this
 * screen.
 */

/** The provider half of `/api/connections`, which is all this screen reads. */
export interface CredentialView {
  name: string;
  label: string;
  environmentVariable: string;
  storedHint: string | null;
  fromEnvironment: boolean;
  configured: boolean;
}

export interface ProviderView {
  id: string;
  displayName: string;
  websiteUrl?: string;
  platforms: string[];
  ready: boolean;
  credentials: CredentialView[];
}

export interface ConnectionsView {
  canStore: boolean;
  storeBlocker: string | null;
  providers: ProviderView[];
}

/** The model half. Only the scoring job's fallback decides anything here. */
export interface TaskView {
  task: "classify" | "triage" | "embed" | "draft";
  providers: string[];
  instance: { provider: string; model: string | null; hasKey: boolean };
  fallback: { source: "key" | "instance"; provider: string; hasKey: boolean };
}

export interface ModelsView {
  canStore: boolean;
  storeBlocker: string | null;
  testModels: Record<string, string>;
  keys: { id: string; name: string; provider: string | null; hint: string; isDefault: boolean }[];
  tasks: TaskView[];
}

const providerNames: Record<string, string> = {
  anthropic: "Anthropic",
  google: "Google",
  ollama: "Ollama",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

function providerName(provider: string): string {
  return providerNames[provider] ?? provider;
}

/**
 * Whether the account can collect anything at all.
 *
 * Any one provider, rather than a platform that can be collected: choosing
 * between two providers for one platform is a question this screen does not
 * ask, and the connections screen does. US-088 asks for one key.
 */
export function hasProviderKey(view: ConnectionsView): boolean {
  return view.providers.some((provider) => provider.ready);
}

/**
 * Whether the account can score anything.
 *
 * The scoring job's fallback, which is the server's own answer to "what runs
 * when this job has no settings" — the account's default key when there is
 * one, and the machine's key otherwise. Reading `keys.length` instead would
 * call a self-hosted instance unconfigured, and reading the environment
 * instead would miss the account that pasted a key.
 */
export function hasModelKey(view: ModelsView): boolean {
  return view.tasks.find((task) => task.task === "classify")?.fallback.hasKey === true;
}

/** Paste one provider key. The connections route tests it before storing it. */
function ProviderStep({
  providers,
  onSaved,
}: {
  providers: ProviderView[];
  onSaved: (view: ConnectionsView) => void;
}) {
  /**
   * SocialCrawl by default when this build registers it, and the first
   * provider otherwise.
   *
   * A select needs a value, and the value is a guess about who the person has.
   * SocialCrawl is the one key that unlocks every platform this product fetches
   * through it — X, LinkedIn, YouTube, TikTok, Instagram and Reddit — so a new
   * account that pastes one key gets the whole product. Registration order is
   * the fallback, not the rule: the first registered provider is an artefact
   * of how the connectors were added, not a recommendation.
   */
  const defaultProviderId =
    providers.find((one) => one.id === "socialcrawl")?.id ?? providers[0]?.id ?? "";
  const [chosen, setChosen] = useState(defaultProviderId);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = providers.find((one) => one.id === chosen);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!provider) return;

    setBusy(true);
    setError(null);

    try {
      // The route answers with the whole screen since US-090 — a stored key can
      // record the fetcher for platforms that had none — so the gate takes the
      // whole view back and re-decides from it, the way it re-decides after the
      // model half.
      onSaved(
        await requestJson<ConnectionsView>(`/api/connections/${provider.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          // The key travels in the body. A query string would put it in the
          // access log, the browser history and every proxy between.
          body: JSON.stringify({
            credentials: Object.fromEntries(
              Object.entries(typed).filter(([, value]) => value.trim()),
            ),
          }),
        }),
      );
    } catch (cause) {
      // The provider's own refusal where there is one, and the difference
      // between a wrong key and an unreachable provider, which the route keeps
      // apart on purpose.
      setError(messageFor(cause, "That key could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} aria-busy={busy}>
      <div className="field-stack">
        <label className="field">
          <span>Provider</span>
          <small>One account can fetch several platforms. Connect the one you have.</small>
          <select
            aria-label="Data provider"
            className="form-control"
            disabled={busy}
            value={chosen}
            onChange={(event) => {
              setChosen(event.target.value);
              setTyped({});
              setError(null);
            }}
          >
            {providers.map((one) => (
              <option key={one.id} value={one.id}>
                {one.displayName}
              </option>
            ))}
          </select>
        </label>

        {provider?.websiteUrl && (
          <a
            className="onboarding-provider-website"
            href={provider.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${provider.displayName} website (opens in a new tab)`}
          >
            Visit {provider.displayName} website
            <span aria-hidden="true">↗</span>
          </a>
        )}

        {/* What this one key unlocks, in the same words the connections screen uses. */}
        {provider && provider.platforms.length > 0 && (
          <p className="connection-platforms">
            {provider.platforms.map((platform) => (
              <span className="brand-label" key={platform}>
                <BrandIcon brand={platform} size={16} />
                {platform}
              </span>
            ))}
          </p>
        )}

        {provider?.credentials.map((credential) => (
          <label className="field" key={credential.name}>
            <span>{credential.label}</span>
            <small>
              Or set <code>{credential.environmentVariable}</code> in this instance's environment
              and restart.
            </small>
            <input
              aria-label={`${credential.label} for ${provider.displayName}`}
              autoComplete="off"
              disabled={busy}
              placeholder="Paste the key"
              required
              spellCheck={false}
              // The browser must not offer this back on another screen, and a
              // key on a shared screen must not be readable over a shoulder.
              type="password"
              value={typed[credential.name] ?? ""}
              onChange={(event) => {
                setError(null);
                setTyped((current) => ({ ...current, [credential.name]: event.target.value }));
              }}
            />
          </label>
        ))}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="setup-actions">
        <button className="primary-button" disabled={busy || !provider} type="submit">
          {busy ? "Testing the key…" : "Save the provider key"}
        </button>
      </div>
    </form>
  );
}

/** Paste one model key. The key route tests it with the provider first. */
function ModelStep({
  providers,
  testModels,
  instance,
  onSaved,
}: {
  providers: string[];
  /** The model a key on each provider is tested with. Empty where none is known. */
  testModels: Record<string, string>;
  /** What this deployment is configured for, which is the likeliest answer. */
  instance: { provider: string; model: string | null };
  onSaved: (view: ModelsView) => void;
}) {
  const first = providers.includes(instance.provider) ? instance.provider : (providers[0] ?? "");

  /**
   * What a key on this provider is tested against.
   *
   * Empty for OpenRouter and Ollama, and that is not an omission: this build
   * recommends no model for either — OpenRouter resells four hundred and
   * Ollama runs whatever the machine has pulled — so the person names one.
   */
  const suggestedModel = useCallback(
    (one: string): string =>
      testModels[one] ?? (one === instance.provider ? (instance.model ?? "") : ""),
    [testModels, instance],
  );

  const [provider, setProvider] = useState(first);
  const [name, setName] = useState(`${providerName(first)} key`);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(suggestedModel(first));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      onSaved(
        await requestJson<ModelsView>("/api/models/keys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, provider, apiKey, model }),
        }),
      );
    } catch (cause) {
      setError(messageFor(cause, "That key could not be stored."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} aria-busy={busy}>
      <div className="field-stack">
        <label className="field">
          <span>Provider</span>
          <select
            aria-label="Model provider"
            className="form-control"
            disabled={busy}
            value={provider}
            onChange={(event) => {
              const one = event.target.value;

              // The name and the test model both belong to the provider. A
              // model named for OpenAI is not a name Anthropic answers to, and
              // leaving it would test the wrong pairing.
              setProvider(one);
              setName(`${providerName(one)} key`);
              setModel(suggestedModel(one));
              setError(null);
            }}
          >
            {providers.map((one) => (
              <option key={one} value={one}>
                {providerName(one)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Name</span>
          <small>What this key is called in your account. You can add more later.</small>
          <input
            aria-label="Key name"
            className="form-control"
            disabled={busy}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="field">
          <span>Key</span>
          <input
            aria-label="Model API key"
            autoComplete="off"
            className="form-control"
            disabled={busy}
            placeholder="Pasted once, stored encrypted"
            required
            spellCheck={false}
            type="password"
            value={apiKey}
            onChange={(event) => {
              setError(null);
              setApiKey(event.target.value);
            }}
          />
        </label>

        <label className="field">
          <span>Model to test with</span>
          <small>
            One short call proves the key before it is stored. The model is not kept — each job
            picks its own.
          </small>
          <input
            aria-label="Model to test with"
            className="form-control"
            disabled={busy}
            placeholder="Name a model this provider serves"
            required
            spellCheck={false}
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="setup-actions">
        <button className="primary-button" disabled={busy || !provider} type="submit">
          {busy ? "Testing the key…" : "Save the model key"}
        </button>
      </div>
    </form>
  );
}

/** One finished step, so the page shows what is done as well as what is left. */
function DoneRow({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="onboarding-done" role="status">
      <span aria-hidden="true">✓</span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}

/**
 * The gate itself.
 *
 * `connections` and `models` are handed in rather than fetched here, because
 * `App.tsx` has already read them to decide whether to show this at all, and
 * reading them twice would let the gate and the screen disagree about what is
 * missing. `onSaved` gives the new view back so the gate re-decides.
 */
export function Onboarding({
  connections,
  models,
  onSaved,
  onFinished,
}: {
  connections: ConnectionsView;
  models: ModelsView;
  onSaved: (views: { connections?: ConnectionsView; models?: ModelsView }) => void;
  /** Pressed when both keys are in. The application is what comes next. */
  onFinished: () => void;
}) {
  const providerDone = hasProviderKey(connections);
  const modelDone = hasModelKey(models);
  const canStore = connections.canStore && models.canStore;
  const classify = models.tasks.find((task) => task.task === "classify");
  const connected = connections.providers.find((provider) => provider.ready);
  const defaultKey = models.keys.find((key) => key.isDefault) ?? models.keys[0];

  const steps = [
    { id: "provider", label: "Connect a data provider", done: providerDone },
    { id: "model", label: "Add a model key", done: modelDone },
  ];

  /**
   * Signing out is the only way off this page, and it has to be here.
   *
   * Without it somebody signed in to the wrong account on a shared machine is
   * stuck: every screen is behind the gate, and the sidebar that holds the
   * sign-out button is behind it too.
   */
  async function signOut(): Promise<void> {
    try {
      await requestJson("/api/auth/sign-out", { method: "POST" });
    } finally {
      globalThis.location.reload();
    }
  }

  return (
    <main className="product-page setup-page onboarding-page">
      <header className="topbar">
        <div className="onboarding-brand">
          <BrandLogo />
          <div>
            <h1>Set up SignalScout</h1>
            <p className="page-subtitle">
              Two keys before the first monitor: one to fetch the conversations, one to read them.
              Both stay in this instance.
            </p>
          </div>
        </div>
        <button className="top-secondary-link" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      <div className="setup-layout">
        <aside className="setup-progress" aria-label="Setup progress">
          <p className="setup-progress-label">
            {providerDone && modelDone
              ? "Setup complete"
              : `${steps.filter((step) => step.done).length} of ${steps.length} done`}
          </p>
          <ol>
            {steps.map((step, index) => (
              <li
                aria-current={!step.done ? "step" : undefined}
                className={step.done ? "complete" : ""}
                key={step.id}
              >
                <span aria-hidden="true">{step.done ? "✓" : index + 1}</span>
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
          <p className="setup-progress-note">
            Each key is tested with the provider before it is stored. A key the provider refuses is
            never kept.
          </p>
        </aside>

        <section className="setup-content" aria-label="Set up this account">
          {!canStore && (
            <div className="notice warning" role="status">
              <strong>Key storage needs setup</strong>
              <span>{connections.storeBlocker ?? models.storeBlocker}</span>
            </div>
          )}

          <div className="onboarding-step">
            <div className="setup-heading">
              <h2>1. Connect a data provider</h2>
              <p>
                A provider fetches the public conversations. One key is enough to start, and the
                rest can be connected later.
              </p>
            </div>

            {providerDone ? (
              <DoneRow
                title={`${connected?.displayName ?? "A provider"} is connected`}
                detail={
                  connected?.platforms.length
                    ? `Fetches ${connected.platforms.join(", ")}.`
                    : "This key is stored in your account."
                }
              />
            ) : connections.providers.length === 0 ? (
              <div className="notice warning" role="status">
                <strong>No provider is available</strong>
                <span>This build registers no data provider, so there is nothing to connect.</span>
              </div>
            ) : (
              canStore && (
                <ProviderStep
                  providers={connections.providers}
                  onSaved={(saved) => onSaved({ connections: saved })}
                />
              )
            )}
          </div>

          <div className="onboarding-step">
            <div className="setup-heading">
              <h2>2. Add a model key</h2>
              <p>
                A model reads each post and scores it against your monitor. This key pays for every
                job until you give one a key of its own.
              </p>
            </div>

            {modelDone ? (
              <DoneRow
                title={defaultKey ? `${defaultKey.name} is ready` : "This instance has a model key"}
                detail={
                  defaultKey
                    ? `${defaultKey.provider ? providerName(defaultKey.provider) : "No provider set"} · ${defaultKey.hint}`
                    : "Set in this instance's environment."
                }
              />
            ) : (
              canStore && (
                <ModelStep
                  providers={classify?.providers ?? []}
                  testModels={models.testModels}
                  instance={
                    classify?.instance ?? {
                      provider: models.tasks[0]?.instance.provider ?? "",
                      model: null,
                    }
                  }
                  onSaved={(saved) => onSaved({ models: saved })}
                />
              )
            )}
          </div>

          {providerDone && modelDone && (
            <div className="setup-actions onboarding-finish">
              <button className="primary-button" type="button" onClick={onFinished}>
                Start using SignalScout
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
