import { useEffect, useState } from "react";
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

  useEffect(() => {
    requestJson<{ prompts: SavedPrompt[] }>("/api/reply-prompts")
      .then((body) => setPrompts(body.prompts))
      .catch(() => {
        // A prompt list that will not load must not stop somebody drafting
        // without one. The button below works with no prompts at all.
      });
  }, []);

  const selected = prompts.find((prompt) => prompt.id === promptId);

  function choose(id: string): void {
    setPromptId(id);
    setInstruction(prompts.find((prompt) => prompt.id === id)?.instruction ?? "");
    setName("");
  }

  async function generate(): Promise<void> {
    setDrafting(true);
    setError(null);
    setCopied(false);

    try {
      const body = await requestJson<Draft>(`/api/matches/${matchId}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ promptId: promptId || null }),
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
    } catch (cause) {
      setError(messageFor(cause, "The prompt could not be deleted."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="reply-draft">
      <p className="section-label">Draft a reply</p>

      <div className="reply-draft-controls">
        <label className="filter">
          <span>Voice</span>
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
          className="primary-button"
          disabled={drafting}
          type="button"
          onClick={() => void generate()}
        >
          {drafting ? "Writing…" : "Draft reply"}
        </button>

        <button
          className="read-more-button"
          type="button"
          aria-expanded={managing}
          onClick={() => setManaging(!managing)}
        >
          {managing ? "Hide prompts" : "Edit prompts"}
        </button>
      </div>

      {managing && (
        <div className="reply-draft-prompts">
          <label className="field">
            <span>
              Your instruction, appended to every draft you make with it. It steers the wording; it
              cannot make the draft open with your product or invent facts about it.
            </span>
            <textarea
              aria-label="Instruction"
              rows={3}
              value={instruction}
              placeholder="Write plainly, no exclamation marks, and always ask one question back."
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>

          <div className="reply-draft-prompt-actions">
            {selected ? (
              <>
                <button
                  className="compact-button"
                  disabled={saving || !instruction.trim()}
                  type="button"
                  onClick={() => void saveExisting()}
                >
                  Save “{selected.name}”
                </button>
                <button
                  className="compact-button"
                  disabled={saving}
                  type="button"
                  onClick={() => void remove()}
                >
                  Delete
                </button>
              </>
            ) : null}

            <input
              aria-label="New prompt name"
              placeholder="Name this voice"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button
              className="compact-button"
              disabled={saving || !name.trim() || !instruction.trim()}
              type="button"
              onClick={() => void saveNew()}
            >
              Save as new
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {draft && (
        <div className="reply-draft-result">
          <label className="field">
            <span>Yours to edit. Nothing is posted from here — copy it and post it yourself.</span>
            <textarea
              aria-label="Draft reply"
              rows={7}
              value={reply}
              onChange={(event) => {
                setReply(event.target.value);
                setCopied(false);
              }}
            />
          </label>

          {draft.uncertainties.length > 0 && (
            <div className="reply-draft-checks">
              <p className="section-label">Check before you post</p>
              <ul>
                {draft.uncertainties.map((item) => (
                  <li key={item}>
                    <span aria-hidden="true">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="reply-draft-actions">
            <button className="primary-button" type="button" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </button>
            <span className="match-meta">
              {draft.model} · {cost(draft.estimatedCostMicros)} estimated
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
