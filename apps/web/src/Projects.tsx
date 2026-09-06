import { useCallback, useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";

/**
 * Projects: the answers that describe a business, typed once. US-045.
 *
 * The four fields here are the same four the monitor form asks for, and that
 * repetition is the point of the screen — a person with three monitors was
 * typing them three times and typing them slightly differently each time.
 *
 * **A monitor takes a copy.** Editing a project changes what the next monitor
 * starts from and nothing that already exists, which is stated on the screen
 * rather than left to be discovered. The reason is `monitors.version`: a
 * verdict is recorded against the version that earned it, so an edit that
 * reached existing monitors would quietly discard every verdict already given.
 */

interface SignalOption {
  id: string;
  label: string;
  hint: string;
}

interface Project {
  id: string;
  name: string;
  product: string;
  idealCustomer: string;
  problem: string;
  signals: string[];
  monitorCount: number;
}

interface Draft {
  name: string;
  product: string;
  idealCustomer: string;
  problem: string;
  signals: string[];
}

const empty: Draft = { name: "", product: "", idealCustomer: "", problem: "", signals: [] };

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [signals, setSignals] = useState<SignalOption[]>([]);
  const [draft, setDraft] = useState<Draft>(empty);
  /** The project being edited, or null while the form is making a new one. */
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const answer = await requestJson<{ projects: Project[] }>("/api/projects");
      setProjects(answer.projects);
    } catch (cause) {
      setError(messageFor(cause, "The projects could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    requestJson<{ signals: SignalOption[] }>("/api/monitor-options")
      .then((options) => setSignals(options.signals))
      .catch(() => setSignals([]));
  }, [load]);

  const change = (field: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const toggleSignal = (id: string) =>
    setDraft((current) => ({
      ...current,
      signals: current.signals.includes(id)
        ? current.signals.filter((signal) => signal !== id)
        : [...current.signals, id],
    }));

  const complete =
    draft.name.trim() !== "" &&
    draft.product.trim() !== "" &&
    draft.idealCustomer.trim() !== "" &&
    draft.problem.trim() !== "";

  async function save() {
    setBusy(true);
    setError(null);

    try {
      await requestJson<Project>(editing ? `/api/projects/${editing}` : "/api/projects", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });

      setDraft(empty);
      setEditing(null);
      await load();
    } catch (cause) {
      setError(messageFor(cause, "The project could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  function edit(project: Project) {
    setEditing(project.id);
    setDraft({
      name: project.name,
      product: project.product,
      idealCustomer: project.idealCustomer,
      problem: project.problem,
      signals: [...project.signals],
    });
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Tracking setup</p>
          <h1>Projects</h1>
        </div>
      </header>

      <section className="setup-content" aria-label="Project details">
        <h2>{editing ? "Edit this project" : "New project"}</h2>
        <p className="setup-progress-note">
          A project holds what every monitor for one business repeats. A monitor made from it{" "}
          <strong>takes a copy</strong>, so editing a project changes what the next monitor starts
          from and leaves the monitors you already have exactly as they are.
        </p>

        {error && <p className="form-error">{error}</p>}

        <label className="field">
          <span>Name</span>
          <input
            aria-label="Name"
            value={draft.name}
            placeholder="Acme QA"
            onChange={(event) => change("name")(event.target.value)}
          />
        </label>

        <label className="field">
          <span>What is the product?</span>
          <textarea
            aria-label="What is the product?"
            rows={2}
            value={draft.product}
            placeholder="A test runner for small teams"
            onChange={(event) => change("product")(event.target.value)}
          />
        </label>

        <label className="field">
          <span>Who is it for?</span>
          <textarea
            aria-label="Who is it for?"
            rows={2}
            value={draft.idealCustomer}
            placeholder="Small SaaS teams with no dedicated QA"
            onChange={(event) => change("idealCustomer")(event.target.value)}
          />
        </label>

        <label className="field">
          <span>What problem does it solve?</span>
          <textarea
            aria-label="What problem does it solve?"
            rows={2}
            value={draft.problem}
            placeholder="Their end to end tests break on every UI change"
            onChange={(event) => change("problem")(event.target.value)}
          />
        </label>

        {signals.length > 0 && (
          <fieldset className="choice-section">
            <legend>Which signals matter?</legend>
            <p>Select the ways a promising conversation might begin.</p>
            <div className="signal-grid">
              {signals.map((signal) => (
                <label className="signal-card" key={signal.id}>
                  <input
                    type="checkbox"
                    checked={draft.signals.includes(signal.id)}
                    onChange={() => toggleSignal(signal.id)}
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
        )}

        <div className="form-actions">
          <button
            className="primary-button"
            type="button"
            disabled={!complete || busy}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : editing ? "Save changes" : "Create project"}
          </button>
          {editing && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setEditing(null);
                setDraft(empty);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </section>

      <section className="setup-content" aria-label="Your projects">
        <h2>Your projects</h2>

        {loading ? (
          <p className="setup-progress-note">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="setup-progress-note">
            No projects yet. Make one and the next monitor starts with its answers filled in.
          </p>
        ) : (
          <ul className="monitor-list">
            {projects.map((project) => (
              <li className="monitor-card" key={project.id}>
                <div className="project-identity">
                  <strong className="project-name">{project.name}</strong>
                  <span className="project-product">{project.product}</span>
                  <small className="project-count">
                    {project.monitorCount === 0
                      ? "No monitors yet"
                      : `${project.monitorCount} monitor${project.monitorCount === 1 ? "" : "s"}`}
                  </small>
                </div>
                <div className="monitor-actions">
                  <a className="secondary-button" href={`#/?project=${project.id}`}>
                    Inbox
                  </a>
                  <a className="secondary-button" href={`#/monitors/new?project=${project.id}`}>
                    New monitor
                  </a>
                  <button className="secondary-button" type="button" onClick={() => edit(project)}>
                    Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
