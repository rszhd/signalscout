import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { messageFor, requestJson } from "./api.js";
import { CostTest, type EstimateReport, exceedsCap } from "./CostTest.js";
import { toMicros } from "./Monitors.js";

interface SignalOption {
  id: string;
  label: string;
  hint: string;
}

interface CredentialOption {
  providerId: string;
  providerName: string;
  label: string;
  environmentVariable: string;
}

/**
 * One platform, which is the only axis this form knows about.
 *
 * A person ticks networks to watch. Which account fetches them is a row on the
 * connections screen, chosen once for every monitor, and US-026 is deliberate
 * that it is not asked here: nobody picking where to listen wants to pick a
 * scraper in the same breath.
 */
interface SourceOption {
  id: string;
  displayName: string;
  /** How a query has to be written here. US-027; the API reads it from the platform. */
  search: { maxQueryWords: number; note: string };
  /** Empty when the platform can be collected. */
  missingCredentials: CredentialOption[];
  ready: boolean;
}

interface MonitorOptions {
  signals: SignalOption[];
  sources: SourceOption[];
  canGenerateQueries: boolean;
}

/**
 * The plan, with one list of queries per platform.
 *
 * US-027. A query is written for somewhere: the same phrase that finds people
 * on Reddit matches nothing on X, so the person edits a list per platform and
 * each list is held to that platform's own limit.
 */
interface QueryPlan {
  queries: Record<string, string[]>;
  subreddits: string[];
  model?: string;
  estimatedCostMicros?: number | null;
}

const emptyPlan: QueryPlan = { queries: {}, subreddits: [] };

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

/**
 * The missing keys as one phrase, grouped by the account they belong to.
 *
 * Fields of one provider are joined with "and", because that account needs
 * both. Providers are joined with "or", because a platform two providers fetch
 * needs one of them — and "and" there would tell a person to open an account
 * they do not need. The server's own sentence groups the same way.
 */
function describeMissing(missing: readonly CredentialOption[]): string {
  const byProvider = new Map<string, { name: string; variables: string[] }>();

  for (const credential of missing) {
    const found = byProvider.get(credential.providerId) ?? {
      name: credential.providerName,
      variables: [],
    };

    found.variables.push(credential.environmentVariable);
    byProvider.set(credential.providerId, found);
  }

  return [...byProvider.values()]
    .map((provider) => `${provider.name} (${provider.variables.join(" and ")})`)
    .join(" or ");
}

/** What the plan says, for telling a tested plan from an edited one. */
function planSignature(
  queries: Readonly<Record<string, readonly string[]>>,
  subreddits: readonly string[],
): string {
  // Sorted by platform so that two identical plans built in a different order
  // are one signature, and a person is not asked to re-test a plan they did
  // not change.
  const byPlatform = Object.keys(queries)
    .sort()
    .map((platform) => [platform, cleanList(queries[platform] ?? [])] as const)
    .filter(([, list]) => list.length > 0);

  return JSON.stringify([byPlatform, cleanList(subreddits)]);
}

/** Every query in the plan, for the "did you keep anything?" check. */
function allQueries(queries: Readonly<Record<string, readonly string[]>>): string[] {
  return Object.values(queries).flatMap((list) => cleanList(list));
}

/** One platform's list, cleaned, keyed for sending. */
function cleanQueries(
  queries: Readonly<Record<string, readonly string[]>>,
  platforms: readonly string[],
): Record<string, string[]> {
  return Object.fromEntries(platforms.map((id) => [id, cleanList(queries[id] ?? [])]));
}

function cleanList(values: readonly string[] | undefined): string[] {
  // A value that is not a list is not one query either. The API is typed, but
  // an older server answering an older shape reaches this component as data,
  // and a form that throws on it shows a person a blank screen instead of
  // their four answers.
  if (!Array.isArray(values)) return [];

  return values.map((value) => value.trim()).filter(Boolean);
}

function priceLabel(micros: number | null | undefined): string | null {
  if (micros === null || micros === undefined) return null;
  if (micros < 10_000) return "Less than $0.01";
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

/**
 * Four answers become a visible search plan.
 *
 * The API owns the signal wording and the validation rules. This component
 * owns the sequence, and keeps the generated plan editable before anything
 * starts. It renders one screen and not the page: `App` holds the header and
 * decides which screen is shown.
 */
export function MonitorForm() {
  const [optionsState, setOptionsState] = useState<OptionsState>({ state: "loading" });
  const [answers, setAnswers] = useState<Answers>(emptyAnswers);
  const [selectedSignals, setSelectedSignals] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [plan, setPlan] = useState<QueryPlan>(emptyPlan);
  const [stage, setStage] = useState<"answers" | "review" | "created">("answers");
  const [created, setCreated] = useState<CreatedMonitor | null>(null);
  const [working, setWorking] = useState<"generating" | "creating" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Dollars, as typed. Empty means no cap, which is a decision and not an oversight. */
  const [cap, setCap] = useState("");
  const [onExhausted, setOnExhausted] = useState("pause");
  const [estimate, setEstimate] = useState<EstimateReport | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") globalThis.location.hash = "#/monitors";
    };

    globalThis.addEventListener("keydown", closeOnEscape);
    return () => globalThis.removeEventListener("keydown", closeOnEscape);
  }, []);
  /** The plan the estimate measured. An edited plan makes the answer stale. */
  const [testedPlan, setTestedPlan] = useState<string | null>(null);

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
            message: messageFor(cause, "The API did not answer."),
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
  const missingCredentials = selectedSourceOptions.flatMap((source) => source.missingCredentials);

  const capMicros = cap.trim() === "" ? null : toMicros(cap);
  const queries = cleanQueries(plan.queries, selectedSources);
  const subreddits = cleanList(plan.subreddits);
  const signature = planSignature(plan.queries, plan.subreddits);
  const stale = testedPlan !== null && testedPlan !== signature;

  /**
   * The plan may not start when the test says it would spend the budget
   * before the month ends.
   *
   * Measured against the budget as it stands now, so raising it clears the
   * flag without buying another sample. A stale answer does not block either:
   * it measured a different plan, and refusing to start over a query the
   * person has since deleted would push them into paying to prove it.
   */
  const overCap = !stale && exceedsCap(estimate?.totals.monthlyCostMicrosHigh ?? null, capMicros);

  const takeReport = useCallback((report: EstimateReport | null) => {
    setEstimate(report);

    if (!report) {
      setTestedPlan(null);
      return;
    }

    // The report carries one probe per platform and term, so the signature is
    // rebuilt from it the way the plan builds one: a query tested for Reddit
    // does not mark the same words tested for X.
    const queriesByPlatform: Record<string, string[]> = {};

    for (const probe of report.queries) {
      if (probe.kind !== "query") continue;

      const list = queriesByPlatform[probe.source] ?? [];
      list.push(probe.term);
      queriesByPlatform[probe.source] = list;
    }

    setTestedPlan(
      planSignature(
        queriesByPlatform,
        report.queries.filter((probe) => probe.kind === "channel").map((probe) => probe.term),
      ),
    );
  }, []);

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
      setPlan({
        queries: Object.fromEntries(selectedSources.map((id) => [id, [""]])),
        subreddits: [],
      });
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
          // Written for the platforms this monitor watches, and no others.
          sources: selectedSources,
        }),
      });
      setPlan(generated);
      setStage("review");
    } catch (cause) {
      setError(messageFor(cause, "The search plan could not be generated."));
    } finally {
      setWorking(null);
    }
  }

  async function createMonitor(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (working) return;
    setError(null);

    if (allQueries(queries).length === 0 && subreddits.length === 0) {
      setError("Keep at least one search query or subreddit.");
      return;
    }

    if (cap.trim() !== "" && capMicros === null) {
      setError("A monthly budget is an amount in dollars, such as 10.");
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
          ...(capMicros === null ? {} : { budget: { monthlyCapMicros: capMicros, onExhausted } }),
          // Kept, not started. The person was shown what it would cost.
          ...(overCap ? { startPaused: true } : {}),
        }),
      });
      setCreated(monitor);
      setStage("created");
    } catch (cause) {
      setError(messageFor(cause, "The monitor could not be created."));
    } finally {
      setWorking(null);
    }
  }

  function reset(): void {
    setAnswers(emptyAnswers);
    setSelectedSignals(options?.signals.map((signal) => signal.id) ?? []);
    setSelectedSources(options?.sources.map((source) => source.id) ?? []);
    setPlan(emptyPlan);
    setCreated(null);
    setError(null);
    setCap("");
    setOnExhausted("pause");
    takeReport(null);
    setStage("answers");
  }

  return (
    <div className="monitor-dialog-backdrop">
      <section
        aria-label="Create a new monitor"
        aria-modal="true"
        className="monitor-dialog"
        role="dialog"
      >
        <a className="monitor-dialog-close" href="#/monitors" aria-label="Close new monitor">
          ×
        </a>
        <header className="monitor-dialog-header">
          <p className="monitor-dialog-kicker">
            <span>New monitor</span>
            <span>
              {stage === "created" ? "Complete" : `Step ${stage === "answers" ? 1 : 2} of 2`}
            </span>
          </p>
          <div className="monitor-dialog-progress" aria-hidden="true">
            <i className="active" />
            <i className={stage === "review" || stage === "created" ? "active" : ""} />
          </div>
        </header>

        <div className="form-card">
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
                    Connect {describeMissing(missingCredentials)} to start collecting. The answers
                    will not be lost.
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

              {selectedSourceOptions.map((source) => {
                const list = plan.queries[source.id] ?? [];
                const limit = source.search.maxQueryWords;

                return (
                  <section className="plan-section" key={`queries-${source.id}`}>
                    <div className="section-title-row">
                      <div>
                        <h3>Search queries for {source.displayName}</h3>
                        <p>
                          Plain phrases, without AND, OR or quote syntax. At most {limit} words
                          each.
                          {source.search.note ? ` ${source.search.note}` : ""}
                        </p>
                      </div>
                      <span>{cleanList(list).length} of 8</span>
                    </div>
                    <div className="query-list">
                      {list.map((query, index) => {
                        const words = query.trim().split(/\s+/).filter(Boolean).length;

                        return (
                          <div className="query-row" key={`query-${source.id}-${index.toString()}`}>
                            <span className="query-number">{index + 1}</span>
                            <input
                              aria-label={`${source.displayName} search query ${index + 1}`}
                              aria-invalid={words > limit}
                              maxLength={80}
                              placeholder="A phrase people might search for"
                              value={query}
                              onChange={(event) =>
                                setPlan((current) => ({
                                  ...current,
                                  queries: {
                                    ...current.queries,
                                    [source.id]: (current.queries[source.id] ?? []).map(
                                      (item, itemIndex) =>
                                        itemIndex === index ? event.target.value : item,
                                    ),
                                  },
                                }))
                              }
                            />
                            <button
                              aria-label={`Remove ${source.displayName} query ${index + 1}`}
                              className="icon-button"
                              type="button"
                              onClick={() =>
                                setPlan((current) => ({
                                  ...current,
                                  queries: {
                                    ...current.queries,
                                    [source.id]: (current.queries[source.id] ?? []).filter(
                                      (_, itemIndex) => itemIndex !== index,
                                    ),
                                  },
                                }))
                              }
                            >
                              <span aria-hidden="true">×</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {/* A query longer than the platform takes is refused by the
                        API, so the form says which one and why before the person
                        presses a button that fails. */}
                    {list.some(
                      (query) => query.trim().split(/\s+/).filter(Boolean).length > limit,
                    ) && (
                      <p className="field-note">
                        A query above is longer than {limit} words. On {source.displayName} a longer
                        phrase has to appear inside a post to match one, and it will not.
                      </p>
                    )}
                    {list.length < 8 && (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          setPlan((current) => ({
                            ...current,
                            queries: {
                              ...current.queries,
                              [source.id]: [...(current.queries[source.id] ?? []), ""],
                            },
                          }))
                        }
                      >
                        <span aria-hidden="true">+</span> Add query
                      </button>
                    )}
                  </section>
                );
              })}

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

              <fieldset className="choice-section budget-section">
                <legend>How much may it spend a month?</legend>
                <p>
                  The monitor stops when it reaches this. Leave it empty for no cap; what it spends
                  is recorded either way.
                </p>
                <div className="budget-row">
                  <label className="field">
                    <span>Monthly budget</span>
                    <div className="amount-input">
                      <span aria-hidden="true">$</span>
                      <input
                        aria-label="Monthly budget"
                        inputMode="decimal"
                        placeholder="10.00"
                        value={cap}
                        onChange={(event) => setCap(event.target.value)}
                      />
                    </div>
                  </label>
                  <label className="field">
                    <span>When it is reached</span>
                    <select
                      aria-label="When it is reached"
                      value={onExhausted}
                      onChange={(event) => setOnExhausted(event.target.value)}
                    >
                      <option value="pause">Pause the monitor</option>
                      <option value="notify">Keep it, and start again next month</option>
                    </select>
                  </label>
                </div>
              </fieldset>

              <CostTest
                monthlyCapMicros={capMicros}
                queries={queries}
                report={estimate}
                sources={selectedSources}
                subreddits={subreddits}
                onReport={takeReport}
              />

              {stale && (
                <div className="notice compact" role="status">
                  <strong>The plan has changed since this test.</strong>
                  <span>Test it again to see what the queries above would cost.</span>
                </div>
              )}

              {missingCredentials.length > 0 && (
                <div className="notice warning" role="status">
                  <strong>This monitor cannot start yet.</strong>
                  <span>
                    It will be saved paused until you connect {describeMissing(missingCredentials)}.
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
                      : overCap
                        ? "Save without starting"
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
                  ? `It will stay paused until you connect ${describeMissing(created.missingCredentials)}.`
                  : "IntentWatch will collect the first conversations on the monitor schedule."}
              </p>
              <button className="primary-button" type="button" onClick={reset}>
                Create another monitor
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
