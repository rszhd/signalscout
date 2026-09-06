import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { messageFor, requestJson } from "./api.js";
import { CostTest, type EstimateReport, exceedsCap } from "./CostTest.js";
import { formatMicros, toMicros } from "./Monitors.js";
import { browserTimezone, type ScheduleChoice, scheduleChoices } from "./schedule.js";

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
  /** Whether the connector that would run here reads replies. US-020. */
  canFetchReplies: boolean;
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

const steps = [
  {
    id: "answers",
    label: "Product",
    title: "What should this monitor find?",
    hint: "Tell us what you sell and who you help.",
  },
  {
    id: "signals",
    label: "Signals",
    title: "What does a promising conversation sound like?",
    hint: "Choose the reasons someone might need your product.",
  },
  {
    id: "sources",
    label: "Sources",
    title: "Where should we listen?",
    hint: "Choose the platforms and conversations to watch.",
  },
  {
    id: "review",
    label: "Search plan",
    title: "Review the search plan",
    hint: "Keep the searches focused. You can edit every phrase.",
  },
  {
    id: "launch",
    label: "Schedule & budget",
    title: "Set the pace and the budget",
    hint: "Choose when to collect, then start when you’re ready.",
  },
] as const;
type SetupStage = (typeof steps)[number]["id"] | "created";

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

/**
 * Four answers become a visible search plan.
 *
 * The API owns the signal wording and the validation rules. This component
 * owns the sequence, and keeps the generated plan editable before anything
 * starts. Each step owns one decision; App routes here as a dedicated page.
 */
export function MonitorForm() {
  const [optionsState, setOptionsState] = useState<OptionsState>({ state: "loading" });
  const [answers, setAnswers] = useState<Answers>(emptyAnswers);
  const [selectedSignals, setSelectedSignals] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  /** US-020. Off by default, because it multiplies what the model reads. */
  const [includeReplies, setIncludeReplies] = useState(false);
  /**
   * When it runs. US-041, and the default is the one that was implicit before
   * this control existed: every hour, every day.
   */
  const [scheduleId, setScheduleId] = useState(scheduleChoices[0]?.id ?? "hourly");
  const [timezone, setTimezone] = useState(browserTimezone());
  const [plan, setPlan] = useState<QueryPlan>(emptyPlan);
  const [stage, setStage] = useState<SetupStage>("answers");
  const [created, setCreated] = useState<CreatedMonitor | null>(null);
  const [working, setWorking] = useState<"generating" | "creating" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Dollars, as typed. Empty means no cap, which is a decision and not an oversight. */
  const [cap, setCap] = useState("");
  const [onExhausted, setOnExhausted] = useState("pause");
  const [estimate, setEstimate] = useState<EstimateReport | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const [generatedFor, setGeneratedFor] = useState<string | null>(null);
  const generationSignature = JSON.stringify([
    answers.product,
    answers.idealCustomer,
    answers.problem,
    [...selectedSignals].sort(),
    [...selectedSources].sort(),
  ]);
  const currentStep = steps.findIndex((step) => step.id === stage);
  useEffect(() => {
    // Moving between steps should put keyboard and screen-reader users at the new heading.
    if (stage !== "created") headingRef.current?.focus();
  }, [stage]);
  function goTo(next: SetupStage) {
    setError(null);
    setStage(next);
  }

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
  /**
   * The platforms this person has ticked that will return no replies.
   *
   * The whole point of showing it: a monitor that asks for replies on a
   * platform whose connector cannot read them still polls and still returns
   * posts, and being given nothing without being told is the failure the
   * acceptance names.
   */
  const repliesUnavailable = selectedSourceOptions.filter((source) => !source.canFetchReplies);
  const schedule =
    scheduleChoices.find((choice) => choice.id === scheduleId) ??
    (scheduleChoices[0] as ScheduleChoice);

  const capMicros = cap.trim() === "" ? null : toMicros(cap);
  const queries = cleanQueries(plan.queries, selectedSources);
  const subreddits = selectedSources.includes("reddit") ? cleanList(plan.subreddits) : [];
  const signature = planSignature(queries, subreddits);
  const stale =
    testedPlan !== null &&
    (testedPlan !== signature ||
      estimate?.pollIntervalSeconds !== schedule.pollIntervalSeconds ||
      [...(estimate?.pollDays ?? [])].sort().join() !== [...schedule.pollDays].sort().join());

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

    if (generatedFor === generationSignature) {
      goTo("review");
      return;
    }
    takeReport(null);
    if (!options.canGenerateQueries) {
      setPlan({
        queries: Object.fromEntries(selectedSources.map((id) => [id, [""]])),
        subreddits: [],
      });
      setGeneratedFor(generationSignature);
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
      setGeneratedFor(generationSignature);
      setPlan(generated);
      setStage("review");
    } catch (cause) {
      setError(messageFor(cause, "The search plan could not be generated."));
    } finally {
      setWorking(null);
    }
  }

  function reviewPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (allQueries(queries).length === 0 && subreddits.length === 0) {
      setError("Keep at least one search query or subreddit.");
      return;
    }
    for (const source of selectedSourceOptions) {
      if (
        (queries[source.id] ?? []).some((query) => {
          const count = query.split(/\s+/).length;
          return count < 2 || count > source.search.maxQueryWords;
        })
      ) {
        for (const group of event.currentTarget.querySelectorAll<HTMLDetailsElement>(
          ".platform-plan",
        )) {
          if (group.dataset.platform === source.id) {
            group.open = true;
            group.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
          }
        }
        setError(
          `Use 2 to ${source.search.maxQueryWords} words in each ${source.displayName} query.`,
        );
        return;
      }
    }
    goTo("launch");
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
          includeReplies,
          pollIntervalSeconds: schedule.pollIntervalSeconds,
          pollDays: [...schedule.pollDays],
          pollTimezone: timezone,
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
    setIncludeReplies(false);
    setScheduleId(scheduleChoices[0]?.id ?? "hourly");
    setTimezone(browserTimezone());
    setGeneratedFor(null);
    setStage("answers");
  }

  return (
    <div className="product-page setup-page">
      <header className="topbar">
        <div>
          <h1>New monitor</h1>
          <p className="page-subtitle">A focused search for people you can help.</p>
        </div>
        <a className="top-secondary-link" href="#/monitors">
          Exit setup
        </a>
      </header>
      <div className="setup-layout">
        <aside className="setup-progress" aria-label="Setup progress">
          <p className="setup-progress-label">
            {stage === "created" ? "Setup complete" : `Step ${currentStep + 1} of ${steps.length}`}
          </p>
          <ol>
            {steps.map((step, index) => (
              <li
                key={step.id}
                aria-current={stage === step.id ? "step" : undefined}
                className={stage === "created" || index < currentStep ? "complete" : ""}
              >
                <span aria-hidden="true">
                  {stage === "created" || index < currentStep ? "✓" : index + 1}
                </span>
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
          <p className="setup-progress-note">Nothing starts collecting until you finish setup.</p>
        </aside>
        <section className="setup-content" aria-label="Create a new monitor">
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

          {options && stage !== "created" && (
            <div className="setup-heading">
              <h2 ref={headingRef} tabIndex={-1}>
                {steps[currentStep]?.title}
              </h2>
              <p>{steps[currentStep]?.hint}</p>
            </div>
          )}
          {options && stage === "answers" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                goTo("signals");
              }}
            >
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

              <div className="setup-actions">
                <a className="secondary-button" href="#/monitors">
                  Cancel
                </a>
                <button className="primary-button" type="submit" disabled={working !== null}>
                  Continue
                </button>
              </div>
            </form>
          )}
          {options && stage === "signals" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!selectedSignals.length) {
                  setError("Choose at least one signal.");
                  return;
                }
                goTo("sources");
              }}
            >
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

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="setup-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={working !== null}
                  onClick={() => goTo("answers")}
                >
                  Back
                </button>
                <button className="primary-button" type="submit" disabled={working !== null}>
                  Continue
                </button>
              </div>
            </form>
          )}
          {options && stage === "sources" && (
            <form onSubmit={generatePlan}>
              <fieldset className="choice-section source-section">
                <legend>Where should it look?</legend>
                <p>Pick at least one platform. You can save now and connect an account later.</p>
                <div className="source-list">
                  {options.sources.map((source) => (
                    <label className="source-card" key={source.id}>
                      <input
                        checked={selectedSources.includes(source.id)}
                        type="checkbox"
                        onChange={() => setSelectedSources(toggle(selectedSources, source.id))}
                      />
                      <span className="source-symbol" aria-hidden="true">
                        {source.id === "reddit"
                          ? "r/"
                          : source.id === "linkedin"
                            ? "in"
                            : source.displayName.slice(0, 2)}
                      </span>
                      <span>
                        <strong>{source.displayName}</strong>
                      </span>
                      <span className={`status-dot ${source.ready ? "ready" : "missing"}`}>
                        {source.ready ? "Ready" : "Not connected"}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="choice-section">
                <legend>Read the replies too?</legend>
                <p>
                  A person describing their problem underneath somebody else's post is the same
                  lead. Fetching those replies is cheap; reading them is not.
                </p>
                <label className="source-card">
                  <input
                    checked={includeReplies}
                    type="checkbox"
                    onChange={() => setIncludeReplies(!includeReplies)}
                  />
                  <span className="source-symbol">💬</span>
                  <span>
                    <strong>Include replies and comments</strong>
                    <small>
                      Replies can reveal more people asking for help, but they multiply the model
                      calls and collection costs.
                    </small>
                  </span>
                </label>

                {includeReplies && repliesUnavailable.length > 0 && (
                  <div className="notice warning" role="status">
                    <strong>
                      {repliesUnavailable.length === 1
                        ? `${repliesUnavailable[0]?.displayName} will not return replies.`
                        : "Some of these will not return replies."}
                    </strong>
                    <span>
                      {repliesUnavailable.map((source) => source.displayName).join(", ")} can be
                      polled for posts here, but the connector this deployment uses for{" "}
                      {repliesUnavailable.length === 1 ? "it" : "them"} cannot read replies. The
                      posts still arrive.
                    </span>
                  </div>
                )}
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
              <div className="setup-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={working !== null}
                  onClick={() => goTo("signals")}
                >
                  Back
                </button>
                <button className="primary-button" type="submit" disabled={working !== null}>
                  {working === "generating"
                    ? "Generating…"
                    : generatedFor === generationSignature
                      ? "Continue to search plan"
                      : options.canGenerateQueries
                        ? "Generate search plan"
                        : "Review search plan"}
                </button>
              </div>
            </form>
          )}
          {options && stage === "review" && (
            <form onSubmit={reviewPlan}>
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
                  <details
                    className="plan-section platform-plan"
                    data-platform={source.id}
                    key={`queries-${source.id}`}
                    open={source.id === selectedSourceOptions[0]?.id}
                  >
                    <summary>
                      <span>Search queries for {source.displayName}</span>
                      <span>{cleanList(list).length} of 8</span>
                    </summary>
                    <p className="platform-plan-hint">
                      Plain phrases, without AND, OR or quote syntax. Use 2 to {limit} words each.
                      {source.search.note ? ` ${source.search.note}` : ""}
                    </p>
                    <div className="query-list">
                      {list.map((query, index) => {
                        const words = query.trim().split(/\s+/).filter(Boolean).length;

                        return (
                          <div className="query-row" key={`query-${source.id}-${index.toString()}`}>
                            <span className="query-number">{index + 1}</span>
                            <input
                              aria-label={`${source.displayName} search query ${index + 1}`}
                              aria-invalid={words > limit || words === 1}
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
                  </details>
                );
              })}

              {selectedSources.includes("reddit") && (
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
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {plan.model && (
                <details className="disclosure generation-details">
                  <summary>Generation details</summary>
                  <p>
                    Written by {plan.model}
                    {plan.estimatedCostMicros != null
                      ? ` · estimated ${formatMicros(plan.estimatedCostMicros)}`
                      : ""}
                  </p>
                </details>
              )}
              <div className="setup-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={working !== null}
                  onClick={() => goTo("sources")}
                >
                  Back
                </button>
                <button className="primary-button" type="submit" disabled={working !== null}>
                  Continue to schedule
                </button>
              </div>
            </form>
          )}
          {options && stage === "launch" && (
            <form onSubmit={createMonitor}>
              <div className="setup-summary">
                <strong>{answers.name}</strong>
                <span>
                  {selectedSourceOptions.map((source) => source.displayName).join(" · ")} ·{" "}
                  {allQueries(queries).length} queries
                  {subreddits.length > 0 ? ` · ${subreddits.length} subreddits` : ""}
                </span>
              </div>
              <fieldset className="choice-section">
                <legend>How often should it look?</legend>
                <p>More frequent searches mean more provider calls.</p>
                <label className="field">
                  <span>Collection schedule</span>
                  <select
                    aria-label="Collection schedule"
                    value={scheduleId}
                    onChange={(event) => setScheduleId(event.target.value)}
                  >
                    {scheduleChoices.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                  <small>{schedule.hint}</small>
                </label>
                <details className="disclosure timezone-setting">
                  <summary>Time zone · {timezone}</summary>
                  <label className="field">
                    <span>Time zone</span>
                    <input
                      aria-label="Time zone"
                      required
                      value={timezone}
                      onChange={(event) => setTimezone(event.target.value)}
                    />
                  </label>
                  <p>Days follow this time zone. We started with your browser’s setting.</p>
                </details>
              </fieldset>{" "}
              <fieldset className="choice-section budget-section">
                <legend>How much may it spend a month?</legend>
                <p>
                  Leave it empty for no cap. The final call can overshoot the cap; its price is
                  known only afterwards. Spending is recorded either way.
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
                pollDays={schedule.pollDays}
                pollIntervalSeconds={schedule.pollIntervalSeconds}
                queries={queries}
                report={estimate}
                sources={selectedSources}
                subreddits={subreddits}
                onReport={takeReport}
              />
              {stale && (
                <div className="notice compact" role="status">
                  <strong>The plan or schedule has changed since this test.</strong>
                  <span>Test again to estimate the current plan and schedule.</span>
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
              <div className="setup-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={working !== null}
                  onClick={() => goTo("review")}
                >
                  Back
                </button>
                <button className="primary-button" type="submit" disabled={working !== null}>
                  {working === "creating"
                    ? "Saving…"
                    : overCap
                      ? "Save without starting"
                      : missingCredentials.length > 0
                        ? "Save monitor paused"
                        : "Start monitor"}
                </button>
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
                  ? created.missingCredentials.length > 0
                    ? `It will stay paused until you connect ${describeMissing(created.missingCredentials)}.`
                    : "Your plan is saved without collecting. Adjust the budget or search plan before starting it from Monitors."
                  : "IntentWatch will collect the first conversations on the monitor schedule."}
              </p>
              <a className="primary-button" href="#/monitors">
                View monitors
              </a>
              <button className="text-button" type="button" onClick={reset}>
                Create another monitor
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
