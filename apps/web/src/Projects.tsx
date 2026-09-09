import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { messageFor, requestJson } from "./api.js";
import { paths } from "./route.js";

/**
 * Projects: the answers that describe a business, typed once. US-045.
 *
 * The four fields here are the same four the monitor form asks for, and that
 * repetition is the point of the screen — a person with three monitors was
 * typing them three times and typing them slightly differently each time.
 *
 * **The signals are not asked here.** They were, and they are asked again on
 * the monitor form two screens later — where they decide what one search
 * looks for rather than what a business is. A project is the description a
 * person types once; which kinds of conversation to chase is a choice per
 * monitor, and asking it twice made the second answer look like a repeat.
 * Projects made before this still hold theirs, and the monitor form still
 * starts from them.
 *
 * **A monitor takes a copy.** Editing a project changes what the next monitor
 * starts from and nothing that already exists, which is stated on the screen
 * rather than left to be discovered. The reason is `monitors.version`: a
 * verdict is recorded against the version that earned it, so an edit that
 * reached existing monitors would quietly discard every verdict already given.
 */

interface Project {
  id: string;
  name: string;
  product: string;
  idealCustomer: string;
  problem: string;
  monitorCount: number;
}

interface Draft {
  name: string;
  product: string;
  idealCustomer: string;
  problem: string;
}

const empty: Draft = { name: "", product: "", idealCustomer: "", problem: "" };

interface DraftedProject extends Draft {
  missing: string[];
  charactersRead: number;
  truncated: boolean;
}

/**
 * Draft the four answers from a page or a file. US-050.
 *
 * The file is read here rather than uploaded, so the only thing that reaches
 * the server is its text: no multipart, no filename to sanitise, no temp file.
 *
 * **What comes back is a draft and not a decision.** These four fields are the
 * ones the classifier reads and `monitors.version` counts, so they are filled
 * in for a person to read, edit and save — nothing here writes anything.
 */
function DraftFromDocument({
  onDrafted,
  disabled,
  onBusy,
}: {
  onDrafted: (draft: DraftedProject) => void;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function draft(body: Record<string, string>) {
    setBusy(true);
    onBusy(true);
    setProblem(null);

    try {
      onDrafted(
        await requestJson<DraftedProject>("/api/projects/describe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    } catch (cause) {
      // The server's own sentence: it names the host, the status or the file
      // type. "Could not analyse" would throw away the part a person can act
      // on.
      setProblem(messageFor(cause, "The document could not be read."));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  async function fromFile(file: File | undefined) {
    if (!file) return;

    const type =
      file.type ||
      (file.name.endsWith(".md")
        ? "text/markdown"
        : file.name.endsWith(".html")
          ? "text/html"
          : "text/plain");

    try {
      await draft({ text: await file.text(), contentType: type, filename: file.name });
    } catch (cause) {
      setProblem(messageFor(cause, "The file could not be read."));
    }
  }

  return (
    <div className="draft-from-document">
      <p className="page-subtitle">
        Use your website or a text, Markdown or HTML file to draft the answers. Review them before
        saving.
      </p>

      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}

      <div className="draft-controls">
        <input
          aria-label="Your product's address"
          placeholder="https://example.com"
          value={url}
          disabled={disabled || busy}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button
          className="secondary-button"
          type="button"
          disabled={disabled || busy || url.trim() === ""}
          onClick={() => void draft({ url: url.trim() })}
        >
          {busy ? "Reading…" : "Read this page"}
        </button>
        <label className="secondary-button draft-file">
          Add a file
          <input
            aria-label="A document about your product"
            type="file"
            accept=".txt,.md,.markdown,.html,text/plain,text/markdown,text/html"
            disabled={disabled || busy}
            onChange={(event) => void fromFile(event.target.files?.[0])}
          />
        </label>
      </div>
    </div>
  );
}

export function Projects() {
  const [editorOpen, setEditorOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [draft, setDraft] = useState<Draft>(empty);
  /** The project being edited, or null while the form is making a new one. */
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** What the model said it could not find. Shown, not swallowed. US-050. */
  const [missing, setMissing] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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
  }, [load]);

  useEffect(() => {
    if (editorOpen) nameInput.current?.focus();
  }, [editorOpen]);

  function closeEditor() {
    setEditorOpen(false);
    setEditing(null);
    setDraft(empty);
    setMissing([]);
    setError(null);
    requestAnimationFrame(() => newButton.current?.focus());
  }

  const change = (field: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

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

      const savedName = draft.name;
      closeEditor();
      setNotice(`${savedName} ${editing ? "updated" : "created"}. Ready for your next monitor.`);
      await load();
    } catch (cause) {
      setError(messageFor(cause, "The project could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  function edit(project: Project) {
    setMissing([]);
    setError(null);
    setNotice(null);
    setEditorOpen(true);
    setEditing(project.id);
    setDraft({
      name: project.name,
      product: project.product,
      idealCustomer: project.idealCustomer,
      problem: project.problem,
    });
  }

  return (
    <>
      <header className="topbar projects-topbar">
        <div>
          <h1>{editorOpen ? (editing ? "Edit project" : "New project") : "Projects"}</h1>
          <p className="page-subtitle">
            {editorOpen
              ? "Describe your business once. Give every new monitor a head start."
              : "Your businesses and the conversations that matter to each."}
          </p>
        </div>
        {!editorOpen && (
          <button
            ref={newButton}
            className="primary-button"
            type="button"
            disabled={loading || !!error}
            onClick={() => {
              setDraft(empty);
              setMissing([]);
              setEditing(null);
              setNotice(null);
              setEditorOpen(true);
            }}
          >
            New project
          </button>
        )}
      </header>

      <div className="projects-content">
        {notice && (
          <p className="project-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
            {!editorOpen && (
              <button className="secondary-button" type="button" onClick={() => void load()}>
                Try again
              </button>
            )}
          </div>
        )}
        {editorOpen ? (
          <section className="project-editor" aria-label="Project details">
            <button
              className="project-text-button"
              type="button"
              disabled={busy || reading}
              onClick={closeEditor}
            >
              ← All projects
            </button>
            <div className="project-editor-layout">
              <aside className="project-editor-guide">
                <span className="project-guide-label">PROJECT PROFILE</span>
                <h2>
                  A little context.
                  <br />
                  Better conversations.
                </h2>
                <p>
                  Tell us what you offer and who needs it. These answers give your monitors a useful
                  starting point.
                </p>
                <div className="project-guide-tip">
                  <strong>Be specific, keep it simple</strong>
                  <p>
                    Describe your customers in their own words. A sentence or two for each answer is
                    enough.
                  </p>
                </div>
              </aside>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (complete && !busy && !reading) void save();
                }}
              >
                <details className="disclosure project-import">
                  <summary>
                    Start from a website or document <span>Optional</span>
                  </summary>
                  <DraftFromDocument
                    disabled={busy}
                    onBusy={setReading}
                    onDrafted={(drafted) => {
                      setDraft({
                        name: drafted.name,
                        product: drafted.product,
                        idealCustomer: drafted.idealCustomer,
                        problem: drafted.problem,
                      });
                      setMissing(drafted.missing);
                    }}
                  />
                </details>

                {missing.length > 0 && (
                  <div className="draft-missing">
                    <p>The document did not say, so these were guessed — check them first:</p>
                    <ul>
                      {missing.map((gap) => (
                        <li key={gap}>{gap}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <fieldset className="project-fields" disabled={busy || reading}>
                  <legend className="project-section-title">About your business</legend>
                  <label className="field">
                    <span>Project name</span>
                    <input
                      ref={nameInput}
                      required
                      aria-label="Name"
                      value={draft.name}
                      placeholder="Northwind"
                      onChange={(event) => change("name")(event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>What is the product?</span>
                    <textarea
                      required
                      aria-label="What is the product?"
                      rows={2}
                      value={draft.product}
                      placeholder="A task tracker for small teams"
                      onChange={(event) => change("product")(event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>Who is it for?</span>
                    <textarea
                      required
                      aria-label="Who is it for?"
                      rows={2}
                      value={draft.idealCustomer}
                      placeholder="Team leads at growing companies"
                      onChange={(event) => change("idealCustomer")(event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>What problem does it solve?</span>
                    <textarea
                      required
                      aria-label="What problem does it solve?"
                      rows={2}
                      value={draft.problem}
                      placeholder="Tasks get lost across chat, email, and spreadsheets"
                      onChange={(event) => change("problem")(event.target.value)}
                    />
                  </label>
                </fieldset>
                <p className="project-copy-note">
                  Each new monitor takes a copy of these answers. Editing this project leaves the
                  monitors you already have unchanged.
                </p>

                <div className="form-actions">
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={!complete || busy || reading}
                  >
                    {busy ? "Saving…" : editing ? "Save changes" : "Create project"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy || reading}
                    onClick={closeEditor}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : (
          <section aria-label="Your projects">
            {loading ? (
              <p className="project-state" role="status">
                Loading projects…
              </p>
            ) : error ? null : projects.length === 0 ? (
              <div className="project-empty">
                <span className="project-empty-mark" aria-hidden="true">
                  ＋
                </span>
                <h2>A home for your business</h2>
                <p>
                  No projects yet. Add your product, audience and the problem you solve. Your next
                  monitor starts with its answers filled in.
                </p>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setEditorOpen(true)}
                >
                  Create your first project
                </button>
              </div>
            ) : (
              <>
                <div className="project-list-heading">
                  <h2>
                    Your projects <span>{projects.length}</span>
                  </h2>
                  <p>Choose a project to explore its conversations.</p>
                </div>
                <ul className="project-list">
                  {projects.map((project) => (
                    <li className="project-row" key={project.id}>
                      <div className="project-card-heading">
                        <span className="project-avatar" aria-hidden="true">
                          {project.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="project-identity">
                          <h2 className="project-name">
                            <Link to={paths.inbox(project.id)}>{project.name}</Link>
                          </h2>

                          <small className="project-count">
                            {project.monitorCount === 0
                              ? "No monitors yet"
                              : `${project.monitorCount} monitor${project.monitorCount === 1 ? "" : "s"}`}
                          </small>
                        </div>
                        <button
                          className="project-edit-button"
                          type="button"
                          onClick={() => edit(project)}
                        >
                          Edit
                        </button>
                      </div>
                      <p className="project-product">{project.product}</p>
                      <div className="project-audience">
                        <span>FOR</span>
                        <p>{project.idealCustomer}</p>
                      </div>
                      <div className="project-actions">
                        <Link className="project-inbox-link" to={paths.inbox(project.id)}>
                          Open inbox →
                        </Link>
                        <Link className="secondary-button" to={paths.newMonitor(project.id)}>
                          New monitor
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </div>
    </>
  );
}
