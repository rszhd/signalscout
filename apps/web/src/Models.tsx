import { type FormEvent, useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";

/**
 * Which model does which job, and whose key pays for it. US-068 to US-081.
 *
 * **The screen is two questions in this order.** *Which keys do I have?* — a
 * list on the account, added once and named. Then, for each of the four jobs,
 * *which key pays, and which model does it?* Everything else on a card is
 * derived from those two answers, and the rebuild is what made that visible:
 * the earlier version asked for a provider beside a key that already named
 * one, offered the instance's model on a provider that had never heard of it,
 * and hid every job behind a disclosure so no two could be compared.
 *
 * Four jobs, because this product asks a model four different things and the
 * right answer differs: US-030 measured that triage only saves money when its
 * model is cheaper than the scorer's, Anthropic publishes no embedding
 * endpoint so similarity needs a provider of its own or stays off, and a draft
 * is the one output that carries somebody's name into another conversation.
 *
 * A key is never filled back into a field. There is nothing to fill one with:
 * the read side is a mask.
 */

interface TaskView {
  task: "classify" | "triage" | "embed" | "draft";
  title: string;
  what: string;
  note: string;
  /** Which providers this job can run on. Similarity has fewer. */
  providers: string[];
  /** What this deployment is set to, and whether it holds a key for it. */
  instance: { provider: string; model: string | null; hasKey: boolean };
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
  inputPriceMicros: number | null;
  outputPriceMicros: number | null;
  /** Which stored key pays for this job. Null is the instance's own. */
  keyId: string | null;
}

interface KeyView {
  id: string;
  name: string;
  provider: string | null;
  hint: string;
}

interface ModelsView {
  canStore: boolean;
  storeBlocker: string | null;
  /** Models this build knows a price for, by provider. */
  pricedModels: Record<string, string[]>;
  /** The embedding model each provider defaults to, which has no price here. */
  embeddingModels: Record<string, string>;
  keys: KeyView[];
  tasks: TaskView[];
}

interface Probe {
  status: "ok" | "answered" | "failed";
  provider: string;
  model: string;
  latencyMs: number;
  costMicros: number | null;
  error: string | null;
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

/** Dollars from micro-dollars, never rounded to cents. See docs/costs.md. */
function dollars(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(6)}`;
}

/**
 * Whether this build knows the model belongs to some *other* provider.
 *
 * Only a name this build prices is judged. An unlisted name is somebody's own
 * — a local model, a release we have not heard of — and clearing it because we
 * do not know it would delete a correct answer.
 */
function belongsElsewhere(
  priced: Record<string, string[]>,
  model: string,
  provider: string,
): boolean {
  if (!model) return false;
  if (priced[provider]?.includes(model)) return false;

  return Object.values(priced).some((models) => models.includes(model));
}

/** What one job editor holds while somebody changes it. */
interface Draft {
  provider: string;
  model: string;
  baseUrl: string;
  /** The chosen key's id, or "" for the instance's own. */
  keyId: string;
}

function draftOf(task: TaskView): Draft {
  return {
    // A concrete provider, never a blank standing for the instance's.
    provider: task.provider ?? task.instance.provider,
    model: task.model ?? "",
    baseUrl: task.baseUrl ?? "",
    keyId: task.keyId ?? "",
  };
}

/**
 * The account's keys.
 *
 * First on the page because it is what a person does first: a key exists, and
 * then a job is pointed at it. Somebody with one provider adds one key and
 * never opens a job.
 */
function KeyLibrary({
  keys,
  canStore,
  providers,
  onChanged,
}: {
  keys: KeyView[];
  canStore: boolean;
  providers: string[];
  onChanged: (view: ModelsView) => void;
}) {
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      onChanged(
        await requestJson<ModelsView>("/api/models/keys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, provider, apiKey }),
        }),
      );

      setName("");
      setProvider("");
      setApiKey("");
    } catch (cause) {
      setError(messageFor(cause, "That key could not be stored."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(stored: KeyView): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      onChanged(
        await requestJson<ModelsView>(`/api/models/keys/${stored.id}`, { method: "DELETE" }),
      );
    } catch (cause) {
      setError(messageFor(cause, "That key could not be removed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="models-section" aria-labelledby="models-keys-title">
      <div className="models-section-heading">
        <h2 id="models-keys-title">API keys</h2>
        <p>
          Add a key once and name it. Each job below chooses one, and a key can pay for as many jobs
          as you like.
        </p>
      </div>

      {keys.length > 0 && (
        <ul className="key-list">
          {keys.map((stored) => (
            <li className="key-row" key={stored.id}>
              <span className="key-identity">
                <strong>{stored.name}</strong>
                <span>
                  {stored.provider ? providerName(stored.provider) : "No provider set"} ·{" "}
                  {stored.hint}
                </span>
              </span>
              {/*
                No confirmation. Nothing is lost that cannot be pasted again,
                every job pointing at it goes back to the instance's key where
                there is one, and to none where there is not — which the job
                then says of itself.
              */}
              <button
                className="secondary-button"
                disabled={busy}
                type="button"
                onClick={() => void remove(stored)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="key-form" onSubmit={add}>
        <div className="key-form-fields">
          <label className="field">
            <span>Name</span>
            <input
              aria-label="Key name"
              placeholder="My OpenAI key"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="field">
            <span>Provider</span>
            <select
              aria-label="Key provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="">Not stated</option>
              {providers.map((one) => (
                <option key={one} value={one}>
                  {providerName(one)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Key</span>
            <input
              aria-label="New API key"
              autoComplete="off"
              disabled={!canStore}
              placeholder="Pasted once, stored encrypted"
              spellCheck={false}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
        </div>

        <p className="key-form-note">
          A key that names a provider sets the provider of every job that uses it.
        </p>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button
          className="primary-button"
          disabled={busy || !canStore || !name.trim() || !apiKey.trim()}
          type="submit"
        >
          {busy ? "Saving…" : "Add key"}
        </button>
      </form>
    </section>
  );
}

/**
 * One job.
 *
 * Open on the page rather than behind a disclosure: there are four, a person
 * comparing them is the normal case, and the settings that matter are two
 * fields. The rest is behind *Advanced*.
 */
function JobCard({
  task,
  keys,
  pricedModels,
  embeddingModels,
  onSaved,
}: {
  task: TaskView;
  keys: KeyView[];
  pricedModels: Record<string, string[]>;
  embeddingModels: Record<string, string>;
  onSaved: (view: ModelsView) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(task));
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The server's answer replaces what is on screen after every write, so an
  // editor cannot drift from the row behind it.
  useEffect(() => setDraft(draftOf(task)), [task]);

  /**
   * The keys this job could use.
   *
   * Similarity runs on fewer providers than the rest, because Anthropic
   * publishes no embedding endpoint. Offering a key the job cannot use offers
   * a refusal nobody can fix from here. A key that names no provider is
   * offered everywhere: nobody said where it belongs.
   */
  const usable = keys.filter((one) => !one.provider || task.providers.includes(one.provider));
  const chosen = usable.find((one) => one.id === draft.keyId);

  /**
   * A key that names its provider answers the provider question outright, so
   * the card shows it rather than asking. Two fields for one answer is how an
   * OpenAI key ends up on an Anthropic job, failing every call while reading
   * as a bad key.
   */
  const fromKey = chosen?.provider ?? null;
  const provider = fromKey ?? draft.provider;
  const onInstanceProvider = provider === task.instance.provider;

  /**
   * What this job would run, as the card stands — typed and unsaved included,
   * because that is what Test sends.
   *
   * **The instance's model is a fallback only on the instance's provider.**
   * `claude-haiku-4-5` is not a name OpenAI answers to, so a job moved
   * elsewhere has no model until somebody names one.
   */
  const model = draft.model.trim() || (onInstanceProvider ? task.instance.model : null);

  /** What the job would pay with: a chosen key, or the machine's if it has one. */
  const paying = chosen
    ? `${chosen.name} · ${chosen.hint}`
    : task.instance.hasKey
      ? "This instance's key"
      : null;

  const customised = Boolean(task.provider || task.model || task.keyId || task.baseUrl);
  const suggestions =
    task.task === "embed"
      ? [embeddingModels[provider]].filter((one): one is string => Boolean(one))
      : (pricedModels[provider] ?? []);

  function change(field: keyof Draft, value: string): void {
    setDraft((current) => {
      /**
       * The provider follows the key in both directions: a key that names one
       * sets it, and the instance's key sets it back to what the instance runs
       * on. A provider left behind from a previous key points the job at
       * something nothing on the card mentions any more.
       */
      const next = {
        ...current,
        [field]: value,
        provider:
          field === "keyId"
            ? (usable.find((one) => one.id === value)?.provider ?? task.instance.provider)
            : field === "provider"
              ? value
              : current.provider,
      };

      // And the model follows the provider: a name this build prices under
      // another provider is a leftover that fails every call.
      return belongsElsewhere(pricedModels, next.model, next.provider)
        ? { ...next, model: "" }
        : next;
    });

    setError(null);
    setNotice(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      onSaved(
        await requestJson<ModelsView>(`/api/models/${task.task}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            // The key's provider still wins on the server. This is what the
            // job runs on when the key names none.
            provider: draft.provider,
            model: draft.model,
            baseUrl: draft.baseUrl,
            // Null is a choice — "the instance's key" — so it is always sent.
            keyId: draft.keyId === "" ? null : draft.keyId,
          }),
        }),
      );

      setNotice("Saved.");
    } catch (cause) {
      setError(messageFor(cause, "That could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  /**
   * One small billed call, because somebody pressed the button.
   *
   * It tests what is on the screen, so the order is test and then keep:
   * asking a person to save first is asking them to commit to the thing they
   * pressed the button to doubt. Nothing is written either way.
   */
  async function test(): Promise<void> {
    setTesting(true);
    setError(null);
    setNotice(null);

    try {
      const answer = await requestJson<Probe>(`/api/models/${task.task}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          keyId: draft.keyId,
          model,
          provider,
          baseUrl: draft.baseUrl,
        }),
      });

      const took = `${(answer.latencyMs / 1000).toFixed(1)} s`;
      const spent = answer.costMicros === null ? "" : `, ${dollars(answer.costMicros)}`;

      if (answer.status === "ok") {
        setNotice(
          `${providerName(answer.provider)} answered as ${answer.model} in ${took}${spent}.`,
        );
      } else if (answer.status === "answered") {
        // The key worked and the bill is real. The model is the doubtful part.
        setNotice(
          `The key works — ${providerName(answer.provider)} billed for the call in ${took}${spent} — ` +
            `but ${answer.model} did not answer in the shape this product asks for. ` +
            (answer.error ?? ""),
        );
      } else {
        setError(answer.error ?? "The call did not come back.");
      }
    } catch (cause) {
      setError(messageFor(cause, "The test could not be run."));
    } finally {
      setTesting(false);
    }
  }

  async function resetToInstance(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      onSaved(await requestJson<ModelsView>(`/api/models/${task.task}`, { method: "DELETE" }));
      setNotice("Using instance defaults.");
    } catch (cause) {
      setError(messageFor(cause, "That could not be removed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="job">
      <div className="job-heading">
        <h3>{task.title}</h3>
        <p>{task.what}</p>
      </div>

      <form className="job-form" onSubmit={submit}>
        <div className="job-fields">
          <label className="field">
            <span>Key</span>
            <select
              aria-label={`${task.title} key`}
              value={draft.keyId}
              onChange={(event) => change("keyId", event.target.value)}
            >
              {/*
                The truth about the machine, not a hopeful label. Where signup
                is open the instance's keys are nobody's to spend, and offering
                one would offer a job that cannot run.
              */}
              <option value="">
                {task.instance.hasKey ? "This instance's key" : "No key — this job cannot run"}
              </option>
              {usable.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name} · {one.provider ? providerName(one.provider) : "no provider"} ·{" "}
                  {one.hint}
                </option>
              ))}
            </select>
            <small>
              {!task.instance.hasKey && !draft.keyId
                ? `This instance has no ${providerName(provider)} key, so this job will not run until you choose one.`
                : usable.length === 0
                  ? "Add a key above to pay for this job from your own account."
                  : "Any key above can pay for this job."}
            </small>
          </label>

          {fromKey ? (
            <p className="field field-fixed">
              <span>Provider</span>
              <strong>{providerName(fromKey)}</strong>
              <small>From the key you chose.</small>
            </p>
          ) : (
            <label className="field">
              <span>Provider</span>
              {/*
                Providers, and no "instance default" among them. A first entry
                naming a setting asks a person to hold what the instance is set
                to in order to read their own job.
              */}
              <select
                aria-label={`${task.title} provider`}
                value={draft.provider}
                onChange={(event) => change("provider", event.target.value)}
              >
                {task.providers.map((one) => (
                  <option key={one} value={one}>
                    {providerName(one)}
                  </option>
                ))}
              </select>
              <small>
                {task.provider
                  ? "Your own choice for this job."
                  : `This instance runs on ${providerName(task.instance.provider)}.`}
              </small>
            </label>
          )}

          <label className="field">
            <span>Model</span>
            <input
              aria-label={`${task.title} model`}
              list={`models-${task.task}`}
              placeholder={
                onInstanceProvider
                  ? (task.instance.model ?? "None — this job is off")
                  : `Name a ${providerName(provider)} model`
              }
              spellCheck={false}
              value={draft.model}
              onChange={(event) => change("model", event.target.value)}
            />
            {/* This job's provider and no other: a name from another one
                fails every call. */}
            <datalist id={`models-${task.task}`}>
              {suggestions.map((one) => (
                <option key={one} value={one} />
              ))}
            </datalist>
            <small>
              {model
                ? "Unlisted models still run, but their cost is not estimated."
                : `This instance's model is a ${providerName(task.instance.provider)} name, so this job needs one of its own.`}
            </small>
          </label>
        </div>

        <p className="job-summary">
          {model ? (
            <>
              Runs <strong>{model}</strong> on {providerName(provider)}
              {paying ? (
                <>
                  , paid by <strong>{paying}</strong>.
                </>
              ) : (
                <>, and has no key to pay for it.</>
              )}
            </>
          ) : (
            <>Not configured: name a model above.</>
          )}
        </p>

        <details className="disclosure job-advanced">
          <summary>Advanced</summary>
          <p className="job-note">{task.note}</p>
          <label className="field">
            <span>Base URL</span>
            <input
              aria-label={`${task.title} base URL`}
              placeholder="The provider's own endpoint"
              spellCheck={false}
              value={draft.baseUrl}
              onChange={(event) => change("baseUrl", event.target.value)}
            />
            <small>For a self-hosted gateway or a local runtime such as Ollama.</small>
          </label>
        </details>

        {(error || notice) && (
          <p className={error ? "form-error" : "job-answer"} role={error ? "alert" : "status"}>
            {error ?? notice}
          </p>
        )}

        <div className="job-actions">
          {/*
            A job on another provider with no model would save a setting that
            cannot run. Refused here and on the server, which is the one that
            has to be right.
          */}
          <button className="primary-button" disabled={busy || testing || !model} type="submit">
            {busy ? "Saving…" : "Save changes"}
          </button>

          {/* Both halves, as they stand on screen — a test with no key would
              test the instance's, which is not what the button says. */}
          {draft.keyId && model && (
            <button
              className="secondary-button"
              disabled={busy || testing}
              type="button"
              onClick={() => void test()}
            >
              {testing ? "Testing…" : "Test key"}
            </button>
          )}

          {/*
            Only where the instance has a key for this job. Clearing a job
            hands it back to the deployment's provider, model and key — and
            where signup is open there is no key to hand it back to, so the
            button would offer a job that cannot run and call it a default.
          */}
          {customised && task.instance.hasKey && (
            <button
              className="text-button"
              disabled={busy || testing}
              type="button"
              onClick={() => void resetToInstance()}
            >
              Use instance defaults
            </button>
          )}
        </div>
      </form>
    </li>
  );
}

function ModelsHeader() {
  return (
    <header className="topbar">
      <div>
        <h1>Models</h1>
        <p className="page-subtitle">Which model does which job, and whose key pays for it.</p>
      </div>
    </header>
  );
}

export function Models() {
  const [view, setView] = useState<ModelsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;

    requestJson<ModelsView>("/api/models")
      .then((answer) => {
        if (current) setView(answer);
      })
      .catch((cause) => {
        if (current) setError(messageFor(cause, "The model settings could not be read."));
      });

    return () => {
      current = false;
    };
  }, []);

  if (error) {
    return (
      <div className="product-page models-page">
        <ModelsHeader />
        <div className="center-state page-state" role="alert">
          <span className="state-icon" aria-hidden="true">
            !
          </span>
          <h2>Models could not be loaded</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="product-page models-page">
        <ModelsHeader />
        <div className="center-state page-state" role="status">
          <div className="spinner" aria-hidden="true" />
          <p>Reading your model settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="product-page models-page">
      <ModelsHeader />

      <main className="models-content">
        {view.storeBlocker && (
          <p className="models-blocker" role="status">
            <span aria-hidden="true">!</span>
            <span>{view.storeBlocker}</span>
          </p>
        )}

        <KeyLibrary
          canStore={view.canStore}
          keys={view.keys}
          onChanged={setView}
          providers={[...new Set(view.tasks.flatMap((task) => task.providers))]}
        />

        <section className="models-section" aria-labelledby="models-jobs-title">
          <div className="models-section-heading">
            <h2 id="models-jobs-title">Jobs</h2>
            {/*
              Two sentences, because the answer differs. Where the machine
              holds keys, a job left alone runs on them; where it does not —
              every instance taking registrations — a job left alone does not
              run at all, and saying otherwise sends somebody away from this
              page thinking they are finished.
            */}
            <p>
              {view.tasks.some((task) => task.instance.hasKey)
                ? "Each job chooses a key and a model. Leave one alone and it runs on this instance's settings."
                : "Each job chooses a key and a model. This instance holds no keys of its own, so a job with none chosen does not run."}
            </p>
          </div>

          <ul className="job-list">
            {view.tasks.map((task) => (
              <JobCard
                embeddingModels={view.embeddingModels}
                key={task.task}
                keys={view.keys}
                onSaved={setView}
                pricedModels={view.pricedModels}
                task={task}
              />
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
