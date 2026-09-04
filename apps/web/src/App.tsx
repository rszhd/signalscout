import { type FormEvent, useEffect, useMemo, useState } from "react";

interface SignalOption {
  id: string;
  label: string;
  hint: string;
}

interface CredentialOption {
  name: string;
  label: string;
  environmentVariable: string;
  configured: boolean;
}

interface SourceOption {
  id: string;
  displayName: string;
  credentials: CredentialOption[];
  ready: boolean;
}

interface MonitorOptions {
  signals: SignalOption[];
  sources: SourceOption[];
  canGenerateQueries: boolean;
}

interface QueryPlan {
  queries: string[];
  subreddits: string[];
  model?: string;
  estimatedCostMicros?: number | null;
}

interface CreatedMonitor {
  id: string;
  name: string;
  paused: boolean;
  missingCredentials: CredentialOption[];
}

interface Answers {
  name: string;
  product: string;
  idealCustomer: string;
  problem: string;
}

type OptionsState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; options: MonitorOptions };

const emptyAnswers: Answers = { name: "", product: "", idealCustomer: "", problem: "" };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as { message?: string } | T | null;

  if (!response.ok) {
    const message = typeof body === "object" && body && "message" in body && body.message;
    throw new Error(message || `The API answered ${response.status}.`);
  }

  return body as T;
}

function cleanList(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function priceLabel(micros: number | null | undefined): string | null {
  if (micros === null || micros === undefined) return null;
  if (micros < 10_000) return "Less than $0.01";
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

/**
 * The first usable product screen: four answers become a visible search plan.
 * The API owns the signal wording and validation rules. This component owns
 * the sequence and keeps the generated plan editable before anything starts.
 */
export function App() {
  const [optionsState, setOptionsState] = useState<OptionsState>({ state: "loading" });
  const [answers, setAnswers] = useState<Answers>(emptyAnswers);
  const [selectedSignals, setSelectedSignals] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [plan, setPlan] = useState<QueryPlan>({ queries: [], subreddits: [] });
  const [stage, setStage] = useState<"answers" | "review" | "created">("answers");
  const [created, setCreated] = useState<CreatedMonitor | null>(null);
  const [working, setWorking] = useState<"generating" | "creating" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    requestJson<MonitorOptions>("/api/monitor-options")
      .then((options) => {
        if (cancelled) return;
        setOptionsState({ state: "ready", options });
        // PLAN.md shows every signal checked. It is the broad, explicit first
        // run; a person can narrow it before generation.
        setSelectedSignals(options.signals.map((signal) => signal.id));
        setSelectedSources(options.sources.map((source) => source.id));
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setOptionsState({
            state: "error",
            message: cause instanceof Error ? cause.message : "The API did not answer.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const options = optionsState.state === "ready" ? optionsState.options : null;
  const selectedSourceOptions = useMemo(
    () => options?.sources.filter((source) => selectedSources.includes(source.id)) ?? [],
    [options, selectedSources],
  );
  const missingCredentials = selectedSourceOptions.flatMap((source) =>
    source.credentials.filter((credential) => !credential.configured),
  );

  function setAnswer(field: keyof Answers, value: string): void {
    setAnswers((current) => ({ ...current, [field]: value }));
  }

  function toggle(list: readonly string[], value: string): string[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  async function generatePlan(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!options || working) return;
    setError(null);

    if (selectedSources.length === 0) {
      setError("Choose at least one source to watch.");
      return;
    }

    if (!options.canGenerateQueries) {
      setPlan({ queries: [""], subreddits: [] });
      setStage("review");
      return;
    }

    setWorking("generating");
    try {
      const generated = await requestJson<QueryPlan>("/api/monitors/queries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product: answers.product,
          idealCustomer: answers.idealCustomer,
          problem: answers.problem,
          signals: selectedSignals,
        }),
      });
      setPlan(generated);
      setStage("review");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The search plan could not be generated.");
    } finally {
      setWorking(null);
    }
  }

  async function createMonitor(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (working) return;
    setError(null);

    const queries = cleanList(plan.queries);
    const subreddits = cleanList(plan.subreddits);
    if (queries.length === 0 && subreddits.length === 0) {
      setError("Keep at least one search query or subreddit.");
      return;
    }

    setWorking("creating");
    try {
      const monitor = await requestJson<CreatedMonitor>("/api/monitors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...answers,
          signals: selectedSignals,
          queries,
          subreddits,
          sources: selectedSources,
        }),
      });
      setCreated(monitor);
      setStage("created");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The monitor could not be created.");
    } finally {
      setWorking(null);
    }
  }

  function reset(): void {
    setAnswers(emptyAnswers);
    setSelectedSignals(options?.signals.map((signal) => signal.id) ?? []);
    setSelectedSources(options?.sources.map((source) => source.id) ?? []);
    setPlan({ queries: [], subreddits: [] });
    setCreated(null);
    setError(null);
    setStage("answers");
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="IntentWatch home">
          <span className="brand-mark" aria-hidden="true">
            iw
          </span>
          <span>IntentWatch</span>
        </a>
        <span className="header-note">Open-source intent monitoring</span>
      </header>

      <div className="page-grid">
        <aside className="intro-panel">
          <p className="eyebrow">New monitor</p>
          <h1>Find the conversations worth joining.</h1>
          <p className="intro-copy">
            Tell us what matters. IntentWatch turns your answers into a search plan you can inspect
            before it runs.
          </p>

          <ol className="steps" aria-label="Monitor creation progress">
            <li className={stage === "answers" ? "current" : "done"}>
              <span className={`step-number ${stage === "answers" ? "active" : "complete"}`}>
                1
              </span>
              <div>
                <strong>Define the intent</strong>
                <small>Product, customer, problem and signals</small>
              </div>
            </li>
            <li className={stage === "review" ? "current" : stage === "created" ? "done" : ""}>
              <span
                className={`step-number ${stage === "review" ? "active" : stage === "created" ? "complete" : ""}`}
              >
                2
              </span>
              <div>
                <strong>Review the search plan</strong>
                <small>Edit every query before it runs</small>
              </div>
            </li>
            <li className={stage === "created" ? "current done" : ""}>
              <span className={`step-number ${stage === "created" ? "active complete" : ""}`}>
                3
              </span>
              <div>
                <strong>Start watching</strong>
                <small>The worker collects on its schedule</small>
              </div>
            </li>
          </ol>
        </aside>

        <section className="form-card">
          {optionsState.state === "loading" && (
            <div className="center-state" role="status">
              <span className="spinner" aria-hidden="true" />
              <h2>Loading monitor options</h2>
              <p>Checking the sources and signals available in this deployment.</p>
            </div>
          )}

          {optionsState.state === "error" && (
            <div className="center-state error-state" role="alert">
              <span className="state-icon">!</span>
              <h2>The API did not answer</h2>
              <p>{optionsState.message}</p>
              <button className="secondary-button" type="button" onClick={() => location.reload()}>
                Try again
              </button>
            </div>
          )}

          {options && stage === "answers" && (
            <form onSubmit={generatePlan}>
              <div className="card-heading">
                <p className="step-label">Step 1 of 2</p>
                <h2>What should this monitor find?</h2>
                <p>Specific answers produce narrower searches and fewer irrelevant posts.</p>
              </div>

              <div className="field-stack">
                <label className="field">
                  <span>Monitor name</span>
                  <small>A short label only you will see.</small>
                  <input
                    aria-label="Monitor name"
                    autoComplete="off"
                    maxLength={80}
                    placeholder="e.g. Teams replacing manual QA"
                    required
                    value={answers.name}
                    onChange={(event) => setAnswer("name", event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>What do you sell?</span>
                  <small>Name the product and what it does.</small>
                  <textarea
                    aria-label="What do you sell?"
                    maxLength={2000}
                    minLength={10}
                    placeholder="A test runner that records browser flows instead of coding them"
                    required
                    rows={2}
                    value={answers.product}
                    onChange={(event) => setAnswer("product", event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Who is most likely to buy it?</span>
                  <small>Describe the team, role or kind of company.</small>
                  <textarea
                    aria-label="Who is most likely to buy it?"
                    maxLength={2000}
                    minLength={10}
                    placeholder="Small SaaS teams without a dedicated QA engineer"
                    required
                    rows={2}
                    value={answers.idealCustomer}
                    onChange={(event) => setAnswer("idealCustomer", event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>What problem does it solve?</span>
                  <small>Use the words a customer might use in a post.</small>
                  <textarea
                    aria-label="What problem does it solve?"
                    maxLength={2000}
                    minLength={10}
                    placeholder="End-to-end tests break whenever the UI changes"
                    required
                    rows={2}
                    value={answers.problem}
                    onChange={(event) => setAnswer("problem", event.target.value)}
                  />
                </label>
              </div>

              <fieldset className="choice-section">
                <legend>Which signals matter?</legend>
                <p>Select the ways a promising conversation might begin.</p>
                <div className="signal-grid">
                  {options.signals.map((signal) => (
                    <label className="signal-card" key={signal.id}>
                      <input
                        checked={selectedSignals.includes(signal.id)}
                        name="signals"
                        type="checkbox"
                        value={signal.id}
                        onChange={() => setSelectedSignals(toggle(selectedSignals, signal.id))}
                      />
                      <span className="checkmark" aria-hidden="true" />
                      <span>
                        <strong>{signal.label}</strong>
                        <small>{signal.hint}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="choice-section source-section">
                <legend>Where should it look?</legend>
                <p>This deployment currently has these source connectors.</p>
                <div className="source-list">
                  {options.sources.map((source) => (
                    <label className="source-card" key={source.id}>
                      <input
                        checked={selectedSources.includes(source.id)}
                        type="checkbox"
                        onChange={() => setSelectedSources(toggle(selectedSources, source.id))}
                      />
                      <span className="source-symbol">r/</span>
                      <span>
                        <strong>{source.displayName}</strong>
                        <small>{source.ready ? "Ready to collect" : "Connection required"}</small>
                      </span>
                      <span className={`status-dot ${source.ready ? "ready" : "missing"}`}>
                        {source.ready ? "Ready" : "Not connected"}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {missingCredentials.length > 0 && (
                <div className="notice warning" role="status">
                  <strong>This monitor will be saved paused.</strong>
                  <span>
                    Set{" "}
                    {missingCredentials
                      .map((credential) => credential.environmentVariable)
                      .join(" and ")}{" "}
                    to start collecting. The answers will not be lost.
                  </span>
                </div>
              )}

              {!options.canGenerateQueries && (
                <div className="notice" role="status">
                  <strong>Query generation is unavailable.</strong>
                  <span>
                    Set AI_API_KEY or use a local Ollama model. You can type the plan yourself now.
                  </span>
                </div>
              )}

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}

              <div className="form-actions end">
                <p>Your answers are stored separately from the search plan.</p>
                <button className="primary-button" disabled={working !== null} type="submit">
                  {working === "generating"
                    ? "Generating…"
                    : options.canGenerateQueries
                      ? "Generate search plan"
                      : "Review search plan"}
                </button>
              </div>
            </form>
          )}

          {options && stage === "review" && (
            <form onSubmit={createMonitor}>
              <div className="card-heading plan-heading">
                <div>
                  <p className="step-label">Step 2 of 2</p>
                  <h2>Review the search plan</h2>
                  <p>Edit anything that feels too broad. Each query becomes a separate search.</p>
                </div>
                {plan.model && (
                  <span className="model-note">
                    Written by {plan.model}
                    {priceLabel(plan.estimatedCostMicros) &&
                      ` · ${priceLabel(plan.estimatedCostMicros)}`}
                  </span>
                )}
              </div>

              {!options.canGenerateQueries && (
                <div className="notice compact">
                  <strong>Write your own plan.</strong>
                  <span>
                    Use plain phrases of at least two words. Boolean operators are not supported.
                  </span>
                </div>
              )}

              <section className="plan-section">
                <div className="section-title-row">
                  <div>
                    <h3>Search queries</h3>
                    <p>Plain phrases, without AND, OR or quote syntax.</p>
                  </div>
                  <span>{cleanList(plan.queries).length} of 8</span>
                </div>
                <div className="query-list">
                  {plan.queries.map((query, index) => (
                    <div className="query-row" key={`query-${index.toString()}`}>
                      <span className="query-number">{index + 1}</span>
                      <input
                        aria-label={`Search query ${index + 1}`}
                        maxLength={80}
                        placeholder="A phrase people might search for"
                        value={query}
                        onChange={(event) =>
                          setPlan((current) => ({
                            ...current,
                            queries: current.queries.map((item, itemIndex) =>
                              itemIndex === index ? event.target.value : item,
                            ),
                          }))
                        }
                      />
                      <button
                        aria-label={`Remove query ${index + 1}`}
                        className="icon-button"
                        type="button"
                        onClick={() =>
                          setPlan((current) => ({
                            ...current,
                            queries: current.queries.filter((_, itemIndex) => itemIndex !== index),
                          }))
                        }
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </div>
                  ))}
                </div>
                {plan.queries.length < 8 && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setPlan((current) => ({ ...current, queries: [...current.queries, ""] }))
                    }
                  >
                    <span aria-hidden="true">+</span> Add query
                  </button>
                )}
              </section>

              <section className="plan-section subreddit-section">
                <div className="section-title-row">
                  <div>
                    <h3>Suggested subreddits</h3>
                    <p>Keep the names only. We add the r/ prefix.</p>
                  </div>
                  <span>{cleanList(plan.subreddits).length} of 8</span>
                </div>
                <div className="subreddit-list">
                  {plan.subreddits.map((subreddit, index) => (
                    <div className="subreddit-row" key={`subreddit-${index.toString()}`}>
                      <span>r/</span>
                      <input
                        aria-label={`Subreddit ${index + 1}`}
                        placeholder="SaaS"
                        value={subreddit}
                        onChange={(event) =>
                          setPlan((current) => ({
                            ...current,
                            subreddits: current.subreddits.map((item, itemIndex) =>
                              itemIndex === index ? event.target.value : item,
                            ),
                          }))
                        }
                      />
                      <button
                        aria-label={`Remove subreddit ${index + 1}`}
                        className="icon-button"
                        type="button"
                        onClick={() =>
                          setPlan((current) => ({
                            ...current,
                            subreddits: current.subreddits.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          }))
                        }
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </div>
                  ))}
                  {plan.subreddits.length < 8 && (
                    <button
                      className="subreddit-add"
                      type="button"
                      onClick={() =>
                        setPlan((current) => ({
                          ...current,
                          subreddits: [...current.subreddits, ""],
                        }))
                      }
                    >
                      + Add subreddit
                    </button>
                  )}
                </div>
              </section>

              {missingCredentials.length > 0 && (
                <div className="notice warning" role="status">
                  <strong>This monitor cannot start yet.</strong>
                  <span>
                    It will be saved paused until{" "}
                    {missingCredentials
                      .map((credential) => credential.environmentVariable)
                      .join(" and ")}{" "}
                    is set.
                  </span>
                </div>
              )}

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}

              <div className="form-actions">
                <button
                  className="secondary-button"
                  disabled={working !== null}
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStage("answers");
                  }}
                >
                  Back to answers
                </button>
                <div className="action-copy">
                  <small>{answers.name}</small>
                  <button className="primary-button" disabled={working !== null} type="submit">
                    {working === "creating"
                      ? "Saving…"
                      : missingCredentials.length > 0
                        ? "Save monitor paused"
                        : "Start monitor"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {options && stage === "created" && created && (
            <div className="center-state success-state" role="status">
              <span className="success-mark" aria-hidden="true">
                ✓
              </span>
              <p className="eyebrow">Monitor created</p>
              <h2>
                {created.name} is {created.paused ? "saved" : "running"}
              </h2>
              <p>
                {created.paused
                  ? `It will stay paused until ${created.missingCredentials.map((credential) => credential.environmentVariable).join(" and ")} is set.`
                  : "IntentWatch will collect the first conversations on the monitor schedule."}
              </p>
              <button className="primary-button" type="button" onClick={reset}>
                Create another monitor
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
