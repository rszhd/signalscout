import { type FormEvent, useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";

/**
 * Which model does which job, and whose key pays for it. US-068.
 *
 * Four cards, because this product asks a model four different things and the
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

/** What one card's form holds while somebody edits it. */
interface Draft {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
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
  pricedModels,
  onSaved,
}: {
  task: TaskView;
  canStore: boolean;
  pricedModels: string[];
  onSaved: (view: ModelsView) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(task));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The server's answer replaces what is on screen after every write, so a
  // card cannot drift from the row behind it.
  useEffect(() => setDraft(draftOf(task)), [task]);

  const usingInstance = !task.provider && !task.model && !task.keyHint && !task.baseUrl;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);

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
      setSaved(true);
    } catch (cause) {
      setError(messageFor(cause, "That could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function useInstance(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      onSaved(await requestJson<ModelsView>(`/api/models/${task.task}`, { method: "DELETE" }));
    } catch (cause) {
      setError(messageFor(cause, "That could not be removed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="model-card">
      <div className="model-card-heading">
        <h2>{task.title}</h2>
        <p>{task.what}</p>
        <p className="model-card-note">{task.note}</p>
      </div>

      <form className="field-stack" onSubmit={submit}>
        <label className="field">
          <span>Provider</span>
          <select
            aria-label={`${task.title} provider`}
            value={draft.provider}
            onChange={(event) => setDraft({ ...draft, provider: event.target.value })}
          >
            <option value="">This instance's ({task.instance.provider})</option>
            {task.providers.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Model</span>
          <input
            aria-label={`${task.title} model`}
            list="priced-models"
            placeholder={task.instance.model ?? "none — this task is off"}
            value={draft.model}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          />
          <small>
            Empty uses this instance's. A model nothing here carries a price for still runs; its
            calls are recorded with no cost rather than a guessed one.
          </small>
        </label>

        <label className="field">
          <span>API key</span>
          <input
            aria-label={`${task.title} API key`}
            autoComplete="off"
            disabled={!canStore}
            placeholder={task.keyHint ?? "This instance's key"}
            type="password"
            value={draft.apiKey}
            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
          />
          <small>
            {task.keyHint
              ? `Stored: ${task.keyHint}. Leave this empty to keep it.`
              : "Empty uses the key this instance is configured with."}
          </small>
        </label>

        <details className="model-advanced">
          <summary>Advanced</summary>
          <label className="field">
            <span>Base URL</span>
            <input
              aria-label={`${task.title} base URL`}
              placeholder="The provider's own endpoint"
              value={draft.baseUrl}
              onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
            />
            <small>For a self-hosted gateway, or a local runtime such as Ollama.</small>
          </label>
        </details>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="model-actions">
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Saving…" : "Save"}
          </button>
          {!usingInstance && (
            <button className="text-button" disabled={busy} type="button" onClick={useInstance}>
              Use this instance's
            </button>
          )}
          {saved && (
            <span className="model-saved" role="status">
              Saved
            </span>
          )}
        </div>
      </form>

      <datalist id="priced-models">
        {pricedModels.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
    </li>
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

  return (
    <div className="models-page">
      <header className="topbar">
        <div>
          <h1>Models</h1>
          <p className="page-subtitle">Which model does which job, and whose key pays for it.</p>
        </div>
      </header>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {view?.storeBlocker && <p className="model-blocker">{view.storeBlocker}</p>}

      {view && (
        <ul className="model-cards">
          {view.tasks.map((task) => (
            <TaskCard
              canStore={view.canStore}
              key={task.task}
              onSaved={setView}
              pricedModels={view.pricedModels}
              task={task}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
