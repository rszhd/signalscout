import { useEffect, useRef, useState } from "react";
import { messageFor, requestJson } from "./api.js";

/**
 * Draft a reply to one match, and keep the prompts that steer it.
 *
 * US-040. **This product does not post.** The panel ends at a copy button, and
 * it says so on screen rather than in a tooltip — PLAN.md puts social
 * publishing on the "what we are NOT building" list, and a person who thinks
 * this sends is a person who will be surprised in public.
 *
 * **Nothing is generated until the button is pressed.** No draft is written
 * when the inbox loads, when a match is opened, or in advance. A draft costs a
 * model call and a person's reputation, and both should be spent on purpose.
 *
 * The draft arrives in a textarea rather than a block of text, because the
 * editing is the point. A model that guessed at something is told to write the
 * doubt into the draft as `[check: …]`, so it lands where a person is already
 * looking; the same doubts are listed underneath for the ones who scan.
 *
 * **The prompts belong to the account, not to a project.** The owner asked for
 * that, and the reason is reuse: a voice is how one person writes, so the same
 * instruction serves every project they run. Several can be saved, because a
 * person replies differently in different rooms, and the choice is made here —
 * at the moment of writing — rather than in a setting somewhere.
 *
 * **What is in the instruction box is what the model is told.** US-063: a
 * saved prompt fills that box and editing it afterwards steers this draft and
 * nothing else, because a person looking at one awkward post wants to say
 * "answer the pricing question first, this one time" and press the button. The
 * dialog is where a voice is saved, updated or deleted — a separate act.
 *
 * **A new match is a new panel.** The inbox mounts this with `key={match.id}`,
 * so opening another match discards this state rather than resetting it. That
 * matters more than it looks: a draft left over from the previous match, shown
 * beside this match's post, is the one mistake here that could be pasted into
 * a real thread.
 */

interface SavedPrompt {
  id: string;
  name: string;
  instruction: string;
  createdAt: string;
  updatedAt: string;
}

interface Draft {
  reply: string;
  uncertainties: string[];
  model: string;
  estimatedCostMicros: number | null;
}

/** Four decimal places, never two. docs/costs.md, and the providers page. */
function cost(micros: number | null): string {
  return micros === null ? "an unknown amount" : `$${(micros / 1_000_000).toFixed(4)}`;
}

export function ReplyDraft({ matchId }: { matchId: string }) {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [promptId, setPromptId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reply, setReply] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const manageButton = useRef<HTMLButtonElement>(null);
  const instructionField = useRef<HTMLTextAreaElement>(null);
  const headingId = `reply-draft-heading-${matchId}`;
  const promptDialogTitleId = `reply-prompt-dialog-${matchId}`;

  useEffect(() => {
    requestJson<{ prompts: SavedPrompt[] }>("/api/reply-prompts")
      .then((body) => setPrompts(body.prompts))
      .catch(() => {
        // A prompt list that will not load must not stop somebody drafting
        // without one. The button below works with no prompts at all.
      });
  }, []);

  useEffect(() => {
    if (!managing) return;

    queueMicrotask(() => instructionField.current?.focus());

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setManaging(false);
      queueMicrotask(() => manageButton.current?.focus());
    }

    globalThis.addEventListener("keydown", closeOnEscape);
    return () => globalThis.removeEventListener("keydown", closeOnEscape);
  }, [managing]);

  const selected = prompts.find((prompt) => prompt.id === promptId);

  function choose(id: string): void {
    setPromptId(id);
    setInstruction(prompts.find((prompt) => prompt.id === id)?.instruction ?? "");
    setName("");
  }

  function closePromptManager(): void {
    setManaging(false);
    queueMicrotask(() => manageButton.current?.focus());
  }

  async function generate(): Promise<void> {
    setDrafting(true);
    setError(null);
    setCopied(false);

    try {
      const body = await requestJson<Draft>(`/api/matches/${matchId}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: instruction.trim() || null }),
      });

      setDraft(body);
      setReply(body.reply);
    } catch (cause) {
      setError(messageFor(cause, "The draft could not be written."));
    } finally {
      setDrafting(false);
    }
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(reply);
      setCopied(true);
    } catch {
      // A browser that refuses the clipboard leaves the text selectable, which
      // is why the draft is a textarea and not a paragraph.
      setError("This browser would not copy. Select the text and copy it yourself.");
    }
  }

  async function reload(): Promise<void> {
    const body = await requestJson<{ prompts: SavedPrompt[] }>("/api/reply-prompts");
    setPrompts(body.prompts);
  }

  async function saveNew(): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      const created = await requestJson<SavedPrompt>("/api/reply-prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, instruction }),
      });

      await reload();
      setPromptId(created.id);
      setName("");
      closePromptManager();
    } catch (cause) {
      setError(messageFor(cause, "The prompt could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  async function saveExisting(): Promise<void> {
    if (!selected) return;

    setSaving(true);
    setError(null);

    try {
      await requestJson(`/api/reply-prompts/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction }),
      });

      await reload();
      closePromptManager();
    } catch (cause) {
      setError(messageFor(cause, "The prompt could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<void> {
    if (!selected) return;

    setSaving(true);
    setError(null);

    try {
      await requestJson(`/api/reply-prompts/${selected.id}`, { method: "DELETE" });
      await reload();
      setPromptId("");
      setInstruction("");
      closePromptManager();
    } catch (cause) {
      setError(messageFor(cause, "The prompt could not be deleted."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby={headingId} aria-busy={drafting} className="reply-draft">
      <header className="reply-draft-heading">
        <span className="reply-draft-mark" aria-hidden="true">
          ✦
        </span>
        <div>
          <h3 id={headingId}>Draft a reply</h3>
          <p>Turn this conversation into a thoughtful starting point.</p>
        </div>
        <span className="reply-draft-safety">
          <span className="reply-draft-safety-icon" aria-hidden="true">
            ✓
          </span>
          You review and post
        </span>
      </header>

      <div className="reply-draft-controls">
        <label className="reply-voice-field">
          <span>Writing voice</span>
          <select
            aria-label="Saved prompt"
            value={promptId}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="">No saved prompt</option>
            {prompts.map((prompt) => (
              <option key={prompt.id} value={prompt.id}>
                {prompt.name}
              </option>
            ))}
          </select>
        </label>

        <button
          ref={manageButton}
          aria-label="Edit prompts"
          className="reply-draft-manage"
          type="button"
          aria-expanded={managing}
          aria-haspopup="dialog"
          onClick={() => setManaging(true)}
        >
          <span className="reply-draft-button-icon" aria-hidden="true">
            ☷
          </span>
          Edit prompts
        </button>

        <button
          aria-label={drafting ? "Writing…" : draft ? "Draft again" : "Draft reply"}
          className="primary-button reply-draft-generate"
          disabled={drafting}
          type="button"
          onClick={() => void generate()}
        >
          {drafting ? (
            <>
              <span className="reply-draft-spinner" aria-hidden="true" />
              Writing…
            </>
          ) : draft ? (
            <>
              <span className="reply-draft-button-icon" aria-hidden="true">
                ✦
              </span>
              Draft again
            </>
          ) : (
            <>
              <span className="reply-draft-button-icon" aria-hidden="true">
                ✦
              </span>
              Draft reply
            </>
          )}
        </button>
      </div>

      {/*
        The box is what is sent, and the library only fills it. US-063: a saved
        prompt's id cannot express "answer the pricing question first, this one
        time", which is the common case for one awkward post. Choosing a prompt
        copies its words here; editing them steers this draft alone; saving is
        a separate act, in the dialog, that a person takes on purpose.
      */}
      <label className="field reply-draft-instruction">
        <span>Instruction for this draft</span>
        <small>
          Optional. Edits here steer this reply only — open Edit prompts to save one for next time.
          It changes the wording; it cannot make the draft open with your product or invent facts
          about it.
        </small>
        <textarea
          aria-label="Instruction for this draft"
          rows={3}
          value={instruction}
          placeholder="Answer the pricing question first, and keep it to three sentences."
          onChange={(event) => setInstruction(event.target.value)}
        />
      </label>

      {managing && (
        <div className="reply-draft-dialog-backdrop">
          <div
            aria-labelledby={promptDialogTitleId}
            aria-modal="true"
            className="reply-draft-dialog"
            role="dialog"
          >
            <header className="reply-draft-dialog-heading">
              <div>
                <h3 id={promptDialogTitleId}>Reply prompts</h3>
                <p>Save writing voices you can reuse across every project.</p>
              </div>
              <button aria-label="Close prompt editor" type="button" onClick={closePromptManager}>
                ×
              </button>
            </header>

            <div className="reply-draft-dialog-body">
              <label className="reply-dialog-select">
                <span>Prompt to edit</span>
                <select
                  aria-label="Prompt to edit"
                  value={promptId}
                  onChange={(event) => choose(event.target.value)}
                >
                  <option value="">Create a new prompt</option>
                  {prompts.map((prompt) => (
                    <option key={prompt.id} value={prompt.id}>
                      {prompt.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Voice instructions</span>
                <small>
                  Steer the wording and tone. Your voice cannot make the draft open with your
                  product or invent facts about it.
                </small>
                <textarea
                  ref={instructionField}
                  aria-label="Instruction"
                  rows={5}
                  value={instruction}
                  placeholder="Write plainly, no exclamation marks, and always ask one question back."
                  onChange={(event) => setInstruction(event.target.value)}
                />
              </label>

              {!selected && (
                <label className="field reply-prompt-name">
                  <span>Prompt name</span>
                  <input
                    aria-label="New prompt name"
                    placeholder="For example, Short and plain"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              )}

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </div>

            <footer className="reply-draft-dialog-actions">
              {selected ? (
                <button
                  className="reply-draft-delete"
                  disabled={saving}
                  type="button"
                  onClick={() => void remove()}
                >
                  Delete prompt
                </button>
              ) : (
                <span />
              )}
              <div>
                <button className="secondary-button" type="button" onClick={closePromptManager}>
                  Cancel
                </button>
                {selected ? (
                  <button
                    className="primary-button"
                    disabled={saving || !instruction.trim()}
                    type="button"
                    onClick={() => void saveExisting()}
                  >
                    Save “{selected.name}”
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    disabled={saving || !name.trim() || !instruction.trim()}
                    type="button"
                    onClick={() => void saveNew()}
                  >
                    Save as new
                  </button>
                )}
              </div>
            </footer>
          </div>
        </div>
      )}

      {error && !managing && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {draft && (
        <div className="reply-draft-result">
          <div className="reply-draft-editor-heading">
            <label htmlFor={`reply-draft-${matchId}`}>Your draft</label>
            <span className="reply-draft-editor-status">Editable</span>
          </div>
          <div className="reply-draft-editor">
            <textarea
              id={`reply-draft-${matchId}`}
              aria-label="Draft reply"
              rows={8}
              value={reply}
              onChange={(event) => {
                setReply(event.target.value);
                setCopied(false);
              }}
            />
            <div className="reply-draft-editor-meta">
              <span>{reply.length} characters</span>
              <span>Nothing is posted from here</span>
            </div>
          </div>

          {draft.uncertainties.length > 0 && (
            <div className="reply-draft-checks">
              <div className="reply-draft-checks-heading">
                <span className="reply-draft-warning-icon" aria-hidden="true">
                  !
                </span>
                <strong>Check before you post</strong>
              </div>
              <ul>
                {draft.uncertainties.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="reply-draft-actions">
            <button
              aria-label={copied ? "Copied" : "Copy draft"}
              aria-live="polite"
              className={`primary-button reply-draft-copy ${copied ? "copied" : ""}`}
              type="button"
              onClick={() => void copy()}
            >
              <span className="reply-draft-button-icon" aria-hidden="true">
                {copied ? "✓" : "⧉"}
              </span>
              {copied ? "Copied" : "Copy draft"}
            </button>
            <span className="reply-draft-cost">
              {draft.model} · {cost(draft.estimatedCostMicros)} estimated
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
