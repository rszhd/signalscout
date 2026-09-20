import { FormError, messageFor, ProjectCard, requestJson } from "@signalscout/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
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
 *
 * **The editor is a page, not a state of this one.** New project and edit
 * project each have an address, so the list can link to them and a person can
 * be sent to them — which is what happens when the setup gate finishes with no
 * project in the account.
 */

interface Project {
  id: string;
  name: string;
  product: string;
  idealCustomer: string;
  problem: string;
  monitorCount: number;
  /** Optional for BUG-009's reason: an older API does not send it. BUG-030. */
  matchCount?: number;
}

/**
 * What a delete will take, in the words the confirmation uses. BUG-030.
 *
 * "Delete Acme QA?" does not say that two monitors and 37 matches go with
 * it, and that is the part a person cannot undo.
 */
export function deleteSentence(project: Project): string {
  const monitors =
    project.monitorCount === 0
      ? null
      : `its ${project.monitorCount === 1 ? "monitor" : `${project.monitorCount} monitors`}`;
  const matches =
    project.matchCount === undefined || project.matchCount === 0
      ? null
      : `the ${project.matchCount === 1 ? "match" : `${project.matchCount} matches`} ${
          project.monitorCount === 1 ? "it" : "they"
        } found`;
  const parts = [project.name, monitors, matches].filter((part) => part !== null);

  if (parts.length === 1) return `Delete ${project.name}?`;
  return `Delete ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}?`;
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

      {problem && <FormError>{problem}</FormError>}

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

/**
 * The list of projects, and the way into the two editor pages.
 *
 * There is no editor state on this screen any more. A project is made and
 * edited on its own address (`/projects/new`, `/projects/<id>/edit`), and this
 * page links to both — which is what lets the setup gate send a new account
 * straight to making its first one.
 */
export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** The project a person has asked to delete and has not yet confirmed. BUG-030. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  /**
   * Delete the project, its monitors and every match they found. BUG-030.
   *
   * The card asked once, in place, with the numbers; this is the press after
   * that.
   *
   * **The row leaves the list here rather than by re-reading it.** US-273: a
   * person who has just deleted one project is usually about to do something
   * else, and a reload moves every other row under them. A failed delete keeps
   * its row and says why above the list, because a row that vanished on a
   * failed request would be a deletion that did not happen.
   */
  async function remove(project: Project): Promise<void> {
    setDeleting(project.id);
    setDeleteError(null);

    try {
      await requestJson<null>(`/api/projects/${project.id}`, { method: "DELETE" });
    } catch (cause) {
      setDeleteError(messageFor(cause, `${project.name} could not be deleted.`));
      return;
    } finally {
      setDeleting(null);
      setConfirming(null);
    }

    setProjects((rows) => rows.filter((row) => row.id !== project.id));
  }

  return (
    <>
      <header className="topbar projects-topbar">
        <div>
          <h1>Projects</h1>
          <p className="page-subtitle">
            Your businesses and the conversations that matter to each.
          </p>
        </div>
        <Link className="primary-button" to={paths.newProject}>
          New project
        </Link>
      </header>

      <div className="projects-content">
        {error && (
          <FormError
            action={
              <button className="secondary-button" type="button" onClick={() => void load()}>
                Try again
              </button>
            }
          >
            {error}
          </FormError>
        )}
        {/* Above the list, not inside the card: the list is correct and the
            project is still there. US-273. */}
        {deleteError && <FormError>{deleteError}</FormError>}
        <section aria-label="Your projects">
          {loading ? (
            <div className="project-state" role="status">
              <span className="project-state-mark" aria-hidden="true" />
              <p>Loading projects…</p>
            </div>
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
              <Link className="primary-button" to={paths.newProject}>
                Create your first project
              </Link>
            </div>
          ) : (
            <>
              <div className="project-list-heading">
                <div>
                  <h2>
                    All projects <span>{projects.length}</span>
                  </h2>
                  <p>Open a project to review the conversations it found.</p>
                </div>
              </div>
              <ul className="project-list">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    name={project.name}
                    inboxHref={paths.inbox(project.id)}
                    product={project.product}
                    audience={project.idealCustomer}
                    status={
                      project.monitorCount === 0
                        ? "No monitors yet"
                        : `${project.monitorCount} monitor${project.monitorCount === 1 ? "" : "s"}`
                    }
                    editHref={paths.editProject(project.id)}
                    /* A project holds several monitors here, so this is where
                       the next one is made. The hosted card offers its one
                       monitor instead. */
                    actions={
                      <Link className="secondary-button" to={paths.newMonitor(project.id)}>
                        New monitor
                      </Link>
                    }
                    deleteQuestion={`${deleteSentence(project)} This cannot be undone.`}
                    confirming={confirming === project.id}
                    deleting={deleting === project.id}
                    onAskDelete={() => {
                      setDeleteError(null);
                      setConfirming(project.id);
                    }}
                    onKeep={() => setConfirming(null)}
                    onDelete={() => void remove(project)}
                  />
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * The editor, on its own address. US-045.
 *
 * `projectId` is null on `/projects/new` and an id on
 * `/projects/<id>/edit`, so this is one form with two modes rather than two
 * screens that would drift apart. A created project goes to its own inbox —
 * the address *of* the business just described — and an edited one goes back
 * to the list it came from.
 */
export function ProjectForm({ projectId }: { readonly projectId: string | null }) {
  const editing = projectId !== null;
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(empty);
  /** Whether the answers are on screen yet. Editing loads them first. */
  const [loading, setLoading] = useState(editing);
  /** A project that will not load is not offered for saving. */
  const [unavailable, setUnavailable] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const nameInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;

    let current = true;
    setLoading(true);

    requestJson<Project>(`/api/projects/${projectId}`)
      .then((project) => {
        if (current) {
          setDraft({
            name: project.name,
            product: project.product,
            idealCustomer: project.idealCustomer,
            problem: project.problem,
          });
        }
      })
      .catch((cause) => {
        // A screen editing a project that cannot be read must not offer a
        // blank form: saving it would make a second project rather than edit
        // the first.
        if (current) {
          setUnavailable(true);
          setError(messageFor(cause, "The project could not be loaded."));
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [projectId, editing]);

  useEffect(() => {
    if (!loading && !unavailable) nameInput.current?.focus();
  }, [loading, unavailable]);

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
      const saved = await requestJson<Project>(
        editing ? `/api/projects/${projectId}` : "/api/projects",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft),
        },
      );

      // A new business is sent to its own inbox, which offers the first
      // monitor; an edited one goes back to the list.
      navigate(editing ? paths.projects : paths.inbox(saved.id));
    } catch (cause) {
      setError(messageFor(cause, "The project could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="topbar projects-topbar">
        <div>
          <h1>{editing ? "Edit project" : "New project"}</h1>
          <p className="page-subtitle">
            Describe your business once. Give every new monitor a head start.
          </p>
        </div>
      </header>

      <div className="projects-content project-form-content">
        {loading ? (
          <p className="project-state" role="status">
            Loading project…
          </p>
        ) : unavailable ? (
          <FormError
            action={
              <Link className="secondary-button" to={paths.projects}>
                All projects
              </Link>
            }
          >
            {error}
          </FormError>
        ) : (
          <section className="project-editor" aria-label="Project details">
            <Link className="project-text-button" to={paths.projects}>
              ← All projects
            </Link>

            {error && <FormError>{error}</FormError>}

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
                  <Link className="secondary-button" to={paths.projects}>
                    Cancel
                  </Link>
                </div>
              </form>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
