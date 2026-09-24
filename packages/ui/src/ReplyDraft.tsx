/**
 * The reply composer: one component, for both applications. US-278.
 *
 * It carries no product. A draft is a model call on whichever key the
 * deployment uses, and the screen says the same thing either way — nothing is
 * posted from here. So it is one component, by the rule US-277 wrote into
 * AGENTS.md: a screen that is the same screen in both products may be shared.
 *
 * Taken from the hosted copy, which is the newer layout — one composing block,
 * no decorative mark, no safety badge — and the reason it went second: sharing
 * the older layout first would have frozen it into the package and made the
 * hosted application take a step back to adopt it.
 */
import { useEffect, useRef, useState } from "react";
import { messageFor, requestJson } from "./api.js";
import { FormError } from "./components/FormError.js";

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
 * "answer the pricing question first, this one time" and press the button.
 * Saved voices are chosen here, but their library is managed elsewhere: a
 * conversation is the wrong context for account-level administration.
 *
 * **A new match is a new panel.** The inbox mounts this with `key={match.id}`,
 * so opening another match discards this state rather than resetting it. That
 * matters more than it looks: a draft left over from the previous match, shown
 * beside this match's post, is the one mistake here that could be pasted into
 * a real thread.
 *
 * **A copy asks whether it was posted, and sets nothing.** US-396. The
 * question is asked where the person already is; the answer is theirs,
 * because a copied draft is not a posted one.
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

export interface ReplyDraftProps {
  readonly matchId: string;
  /** Whether the match is marked replied. US-396. */
  readonly replied?: boolean;
  /** A replied request is in flight. */
  readonly marking?: boolean;
  /** Absent on a page that does not store the mark, and then nothing is asked. */
  readonly onReplied?: (replied: boolean) => void;
}

export function ReplyDraft({
  matchId,
  replied = false,
  marking = false,
  onReplied,
}: ReplyDraftProps) {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [promptId, setPromptId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [customizing, setCustomizing] = useState(false);
  const [dialogPromptId, setDialogPromptId] = useState("");
  const [dialogInstruction, setDialogInstruction] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reply, setReply] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [copied, setCopied] = useState(false);
  // Not reset by an edit, unlike `copied`: the text changing does not
  // un-ask whether the last copy was posted.
  const [askPosted, setAskPosted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customizeButton = useRef<HTMLButtonElement>(null);
  const customInstructionField = useRef<HTMLTextAreaElement>(null);
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
    if (!customizing) return;

    queueMicrotask(() => customInstructionField.current?.focus());

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setCustomizing(false);
      queueMicrotask(() => customizeButton.current?.focus());
    }

    globalThis.addEventListener("keydown", closeOnEscape);
    return () => globalThis.removeEventListener("keydown", closeOnEscape);
  }, [customizing]);

  function choose(id: string): void {
    setPromptId(id);
    setInstruction(prompts.find((prompt) => prompt.id === id)?.instruction ?? "");
  }

  function chooseDialogVoice(id: string): void {
    setDialogPromptId(id);
    setDialogInstruction(prompts.find((prompt) => prompt.id === id)?.instruction ?? "");
  }

  function openCustomizer(): void {
    setError(null);
    setDialogPromptId(promptId);
    setDialogInstruction(instruction);
    setCustomizing(true);
  }

  function closeDialog(): void {
    setCustomizing(false);
    queueMicrotask(() => customizeButton.current?.focus());
  }

  function applyCustomization(): void {
    setPromptId(dialogPromptId);
    setInstruction(dialogInstruction);
    closeDialog();
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
      setAskPosted(true);
    } catch {
      // A browser that refuses the clipboard leaves the text selectable, which
      // is why the draft is a textarea and not a paragraph.
      setError("This browser would not copy. Select the text and copy it yourself.");
    }
  }

  return (
    <section aria-labelledby={headingId} aria-busy={drafting} className="reply-draft">
      <div className="reply-draft-compose">
        <header className="reply-draft-heading">
          <h3 id={headingId}>Draft a reply</h3>
          <p>You review and post.</p>
        </header>

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
            "Draft again"
          ) : (
            "Draft reply"
          )}
        </button>

        <details className="reply-draft-options">
          <summary>
            <span>Voice and guidance</span>
            <small>Optional</small>
          </summary>
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
              ref={customizeButton}
              aria-label={instruction.trim() ? "Edit guidance" : "Customize"}
              className="reply-draft-manage"
              type="button"
              aria-expanded={customizing}
              aria-haspopup="dialog"
              onClick={openCustomizer}
            >
              {instruction.trim() ? "Edit guidance" : "Customize"}
            </button>
          </div>
        </details>
      </div>

      {customizing && (
        <div className="reply-draft-dialog-backdrop">
          <div
            aria-labelledby={promptDialogTitleId}
            aria-modal="true"
            className="reply-draft-dialog"
            role="dialog"
          >
            <header className="reply-draft-dialog-heading">
              <div>
                <h3 id={promptDialogTitleId}>Customize this draft</h3>
                <p>Choose a voice or add guidance for this conversation.</p>
              </div>
              <button aria-label="Close dialog" type="button" onClick={closeDialog}>
                ×
              </button>
            </header>

            <div className="reply-draft-dialog-body">
              <label className="reply-dialog-select">
                <span>Writing voice</span>
                <select
                  aria-label="Writing voice for this draft"
                  value={dialogPromptId}
                  onChange={(event) => chooseDialogVoice(event.target.value)}
                >
                  <option value="">No saved prompt</option>
                  {prompts.map((prompt) => (
                    <option key={prompt.id} value={prompt.id}>
                      {prompt.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Instructions for this draft</span>
                <small>
                  Optional. Adjust the voice or tell the model what matters in this reply. It cannot
                  make the draft open with your product or invent facts about it.
                </small>
                <textarea
                  ref={customInstructionField}
                  aria-label="Instruction for this draft"
                  rows={9}
                  value={dialogInstruction}
                  placeholder="Answer the pricing question first, and keep it to three sentences."
                  onChange={(event) => setDialogInstruction(event.target.value)}
                />
              </label>

              <p className="reply-draft-dialog-note">
                Changes apply to this draft only. Your saved voice will not change.
              </p>
            </div>

            <footer className="reply-draft-dialog-actions reply-draft-dialog-actions-end">
              <div>
                <button className="secondary-button" type="button" onClick={closeDialog}>
                  Cancel
                </button>
                <button className="primary-button" type="button" onClick={applyCustomization}>
                  Apply
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {error && !customizing && <FormError>{error}</FormError>}

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

          {/* Present and empty until a copy, so a screen reader hears the
              question when it appears. */}
          {onReplied && (
            <div className="reply-draft-posted" role="status">
              {askPosted &&
                (replied ? (
                  <span>Marked as replied.</span>
                ) : (
                  <>
                    <span>Did you post it?</span>
                    <button
                      aria-label="Yes, mark as replied"
                      className="secondary-button"
                      disabled={marking}
                      type="button"
                      onClick={() => onReplied(true)}
                    >
                      Yes, mark as replied
                    </button>
                  </>
                ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
