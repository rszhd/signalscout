import { type FormEvent, useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";

/**
 * Which model does which job, and whose key pays for it. US-068.
 *
 * Four jobs, because this product asks a model four different things and the
 * right answer is different for each. That is not a preference: US-030 measured
 * that triage only saves money when its model is cheaper than the scorer's,
 * Anthropic — the default provider — publishes no embedding endpoint at all so
 * similarity needs a provider of its own or stays off, and a draft is the one
 * output that carries somebody's name into another person's conversation.
 *
 * **Every field is an override.** Empty means "use the instance's", and each
 * card shows what that is, so a person who pastes only a key keeps the
 * deployment's measured choices and simply pays for their own calls. That is
 * the common case and it needs no other field.
 *
 * The key box is never filled from the server — there is nothing to fill it
 * with, because the read side is a mask. Leaving it blank on save leaves the
 * stored key alone; removing one is its own button.
 */

interface TaskView {
  task: "classify" | "triage" | "embed" | "draft";
  title: string;
  what: string;
  note: string;
  providers: string[];
  instance: { provider: string; model: string | null };
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
  inputPriceMicros: number | null;
  outputPriceMicros: number | null;
  keyHint: string | null;
}

interface ModelsView {
  canStore: boolean;
  storeBlocker: string | null;
  pricedModels: string[];
  tasks: TaskView[];
}

/** What one job editor holds while somebody changes it. */
interface Draft {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

const taskIcons: Record<TaskView["task"], string> = {
  classify: "◎",
  triage: "⌁",
  embed: "◇",
  draft: "✎",
};

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

function draftOf(task: TaskView): Draft {
  return {
    provider: task.provider ?? "",
    model: task.model ?? "",
    baseUrl: task.baseUrl ?? "",
    apiKey: "",
  };
}

function TaskCard({
  task,
  canStore,
  position,
  onSaved,
}: {
  task: TaskView;
  canStore: boolean;
  position: number;
  onSaved: (view: ModelsView) => void;
}) {
  const usingInstance = !task.provider && !task.model && !task.keyHint && !task.baseUrl;
  const [draft, setDraft] = useState<Draft>(() => draftOf(task));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(task.task === "classify");

  // The server's answer replaces what is on screen after every write, so an
  // editor cannot drift from the row behind it.
  useEffect(() => setDraft(draftOf(task)), [task]);

  const effectiveProvider = task.provider ?? task.instance.provider;
  const effectiveModel = task.model ?? task.instance.model;

  function change(field: keyof Draft, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
    setNotice(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const view = await requestJson<ModelsView>(`/api/models/${task.task}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: draft.provider,
          model: draft.model,
          baseUrl: draft.baseUrl,
          // Blank is "leave the stored key alone", which is why this is not a
          // field the server can tell apart from absent.
          ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        }),
      });

      onSaved(view);
      setNotice("Changes saved");
    } catch (cause) {
      setError(messageFor(cause, "That could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function useInstance(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      onSaved(await requestJson<ModelsView>(`/api/models/${task.task}`, { method: "DELETE" }));
      setNotice("Using instance defaults");
    } catch (cause) {
      setError(messageFor(cause, "That could not be removed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="model-task">
      <details
        className="model-task-disclosure"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="model-task-summary">
          <span className="model-task-icon" aria-hidden="true">
            {taskIcons[task.task]}
          </span>
          <span className="model-task-copy">
            <span className="model-task-kicker">Job {String(position).padStart(2, "0")}</span>
            <strong>{task.title}</strong>
            <span>{task.what}</span>
          </span>
          <span className="model-task-current">
            <span>{usingInstance ? "Instance default" : "Custom setup"}</span>
            <strong>
              {providerName(effectiveProvider)}
              <i className="model-current-separator" aria-hidden="true">
                /
              </i>
              {effectiveModel ?? "Not configured"}
            </strong>
            <small>{task.keyHint ? `Stored key ${task.keyHint}` : "Uses the instance key"}</small>
          </span>
          <span className="model-task-manage">
            <span>Manage</span>
            <i className="model-task-chevron" aria-hidden="true">
              ⌄
            </i>
          </span>
        </summary>

        <form className="model-editor" onSubmit={submit}>
          <div className="model-editor-main">
            <header className="model-editor-heading">
              <h3>Configuration</h3>
              <p>Leave a field empty to inherit the instance setting shown beside it.</p>
            </header>

            <div className="model-field-grid">
              <label className="field">
                <span>Provider</span>
                <select
                  aria-label={`${task.title} provider`}
                  value={draft.provider}
                  onChange={(event) => change("provider", event.target.value)}
                >
                  <option value="">
                    Instance default · {providerName(task.instance.provider)}
                  </option>
                  {task.providers.map((provider) => (
                    <option key={provider} value={provider}>
                      {providerName(provider)}
                    </option>
                  ))}
                </select>
                <small>Who runs this job.</small>
              </label>

              <label className="field">
                <span>Model</span>
                <input
                  aria-label={`${task.title} model`}
                  list="priced-models"
                  placeholder={task.instance.model ?? "None — this job is off"}
                  spellCheck={false}
                  value={draft.model}
                  onChange={(event) => change("model", event.target.value)}
                />
                <small>
                  Instance default · {task.instance.model ?? "not configured"}. Unlisted models
                  still run, but their cost is not estimated.
                </small>
              </label>
            </div>

            <label className="field model-key-field">
              <span>API key</span>
              <input
                aria-label={`${task.title} API key`}
                autoComplete="off"
                disabled={!canStore}
                placeholder={task.keyHint ?? "This instance's key"}
                spellCheck={false}
                type="password"
                value={draft.apiKey}
                onChange={(event) => change("apiKey", event.target.value)}
              />
              <small>
                {task.keyHint
                  ? `Stored: ${task.keyHint}. Leave this empty to keep it.`
                  : "Leave empty to use the key configured for this instance."}
              </small>
            </label>

            <details className="model-advanced">
              <summary>
                <span>Advanced settings</span>
                <small className="model-advanced-hint">Custom endpoint</small>
              </summary>
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
          </div>

          <aside className="model-guidance" aria-label={`Guidance for ${task.title}`}>
            <p className="model-guidance-label">Why it matters</p>
            <p>{task.note}</p>
            <dl>
              <div>
                <dt>Effective provider</dt>
                <dd>{providerName(effectiveProvider)}</dd>
              </div>
              <div>
                <dt>Effective model</dt>
                <dd>{effectiveModel ?? "Off"}</dd>
              </div>
            </dl>
          </aside>

          {(error || notice) && (
            <p
              className={error ? "form-error model-answer" : "model-answer model-answer-good"}
              role={error ? "alert" : "status"}
            >
              {!error && (
                <span className="model-answer-icon" aria-hidden="true">
                  ✓
                </span>
              )}
              {error ?? notice}
            </p>
          )}

          <div className="model-actions">
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save changes"}
            </button>
            {!usingInstance && (
              <button className="text-button" disabled={busy} type="button" onClick={useInstance}>
                Use instance defaults
              </button>
            )}
          </div>
        </form>
      </details>
    </li>
  );
}

function ModelsHeader() {
  return (
    <header className="topbar">
      <div>
        <h1>Models</h1>
        <p className="page-subtitle">Choose the right model for each job in your workflow.</p>
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

  const customTasks = view.tasks.filter(
    (task) => task.provider || task.model || task.keyHint || task.baseUrl,
  ).length;

  return (
    <div className="product-page models-page">
      <ModelsHeader />

      <main className="models-content">
        <section className="models-overview" aria-labelledby="models-overview-title">
          <div>
            <p className="eyebrow">Account model setup</p>
            <h2 id="models-overview-title">Configure only what needs to differ</h2>
            <p>
              Every job starts with this instance&apos;s provider, model, and key. Override a job
              here only when you need a different model or want calls billed to your own account.
            </p>
          </div>
          <div className="models-overview-status">
            <strong>{customTasks}</strong>
            <span>of {view.tasks.length} jobs customized</span>
          </div>
        </section>

        {view.storeBlocker && (
          <p className="model-blocker">
            <span aria-hidden="true">!</span>
            <span>{view.storeBlocker}</span>
          </p>
        )}

        <section className="models-jobs" aria-labelledby="models-jobs-title">
          <header className="models-section-heading">
            <div>
              <h2 id="models-jobs-title">Model jobs</h2>
              <p>Open a job to review or change its configuration.</p>
            </div>
            <span>{view.tasks.length} jobs</span>
          </header>

          <ul className="model-task-list">
            {view.tasks.map((task, index) => (
              <TaskCard
                canStore={view.canStore}
                key={task.task}
                onSaved={setView}
                position={index + 1}
                task={task}
              />
            ))}
          </ul>
        </section>

        <datalist id="priced-models">
          {view.pricedModels.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </main>
    </div>
  );
}
