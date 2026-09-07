import { useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";

/**
 * Account-level writing voices, separate from any one conversation.
 *
 * A reply panel is where somebody uses a voice and makes a one-off adjustment.
 * This page is where they change the reusable library. Keeping those two acts
 * apart prevents an edit made while answering one post from quietly changing
 * every future draft across every project.
 */
interface ReplyVoice {
  id: string;
  name: string;
  instruction: string;
  createdAt: string;
  updatedAt: string;
}

function ReplyVoicesHeader({ disabled = false, onNew }: { disabled?: boolean; onNew: () => void }) {
  return (
    <header className="topbar reply-voices-topbar">
      <div>
        <h1>Reply voices</h1>
        <p className="page-subtitle">Reusable writing guidance for every project.</p>
      </div>
      <button
        aria-label="New voice"
        className="top-primary-button"
        disabled={disabled}
        type="button"
        onClick={onNew}
      >
        <span aria-hidden="true">+</span>
        New voice
      </button>
    </header>
  );
}

export function ReplyVoices() {
  const [voices, setVoices] = useState<ReplyVoice[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = voices?.find((voice) => voice.id === selectedId) ?? null;

  useEffect(() => {
    requestJson<{ prompts: ReplyVoice[] }>("/api/reply-prompts")
      .then(({ prompts }) => {
        setVoices(prompts);
        if (prompts[0]) {
          setSelectedId(prompts[0].id);
          setName(prompts[0].name);
          setInstruction(prompts[0].instruction);
          setEditing(true);
        }
      })
      .catch((cause: unknown) =>
        setError(messageFor(cause, "The reply voices could not be loaded.")),
      );
  }, []);

  function choose(voice: ReplyVoice): void {
    setSelectedId(voice.id);
    setName(voice.name);
    setInstruction(voice.instruction);
    setEditing(true);
    setConfirmingDelete(false);
    setError(null);
    setNotice(null);
  }

  function startNew(): void {
    setSelectedId(null);
    setName("");
    setInstruction("");
    setEditing(true);
    setConfirmingDelete(false);
    setError(null);
    setNotice(null);
  }

  function cancel(): void {
    setConfirmingDelete(false);
    setError(null);
    setNotice(null);

    if (selected) {
      setName(selected.name);
      setInstruction(selected.instruction);
      return;
    }

    const first = voices?.[0];
    if (first) choose(first);
    else setEditing(false);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);

    const fields = { name: name.trim(), instruction: instruction.trim() };

    try {
      const saved = await requestJson<ReplyVoice>(
        selectedId ? `/api/reply-prompts/${selectedId}` : "/api/reply-prompts",
        {
          method: selectedId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(fields),
        },
      );

      setVoices((current) => {
        if (!current) return [saved];
        const exists = current.some((voice) => voice.id === saved.id);
        return exists
          ? current.map((voice) => (voice.id === saved.id ? saved : voice))
          : [...current, saved];
      });
      setSelectedId(saved.id);
      setName(saved.name);
      setInstruction(saved.instruction);
      setNotice(selectedId ? "Voice saved." : "Voice created.");
    } catch (cause) {
      setError(messageFor(cause, "The voice could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!selected) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await requestJson<null>(`/api/reply-prompts/${selected.id}`, { method: "DELETE" });
      const remaining = (voices ?? []).filter((voice) => voice.id !== selected.id);
      setVoices(remaining);
      setConfirmingDelete(false);

      if (remaining[0]) choose(remaining[0]);
      else {
        setSelectedId(null);
        setName("");
        setInstruction("");
        setEditing(false);
      }
    } catch (cause) {
      setError(messageFor(cause, "The voice could not be deleted."));
    } finally {
      setBusy(false);
    }
  }

  if (voices === null && !error) {
    return (
      <div className="product-page reply-voices-page">
        <ReplyVoicesHeader disabled onNew={startNew} />
        <div className="center-state page-state" role="status">
          <div className="spinner" aria-hidden="true" />
          <p>Loading your reply voices.</p>
        </div>
      </div>
    );
  }

  if (voices === null) {
    return (
      <div className="product-page reply-voices-page">
        <ReplyVoicesHeader disabled onNew={startNew} />
        <div className="center-state page-state" role="alert">
          <h2>Reply voices could not be loaded</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="product-page reply-voices-page">
      <ReplyVoicesHeader onNew={startNew} />

      <div className="reply-voices-content">
        <aside className="reply-voices-library" aria-label="Saved reply voices">
          <header>
            <h2>Saved voices</h2>
            <span>{voices.length}</span>
          </header>

          {voices.length > 0 ? (
            <ul>
              {voices.map((voice) => (
                <li key={voice.id}>
                  <button
                    aria-current={selectedId === voice.id ? "true" : undefined}
                    type="button"
                    onClick={() => choose(voice)}
                  >
                    <strong>{voice.name}</strong>
                    <span>{voice.instruction}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="reply-voices-empty-list">
              <span className="reply-voices-empty-icon" aria-hidden="true">
                ✦
              </span>
              <p>No saved voices yet.</p>
            </div>
          )}
        </aside>

        <section className="reply-voice-workspace" aria-label="Reply voice editor">
          {editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <header className="reply-voice-editor-heading">
                <div>
                  <p className="eyebrow">{selected ? "Saved voice" : "New voice"}</p>
                  <h2>{selected ? `Edit ${selected.name}` : "Create a reply voice"}</h2>
                  <p>
                    Voices are available when drafting a reply in any project. One-off changes stay
                    with that draft.
                  </p>
                </div>
              </header>

              <div className="reply-voice-fields">
                <label className="field">
                  <span>Voice name</span>
                  <small>A short name you will recognize in the draft menu.</small>
                  <input
                    aria-label="Voice name"
                    disabled={busy}
                    maxLength={120}
                    placeholder="Short and plain"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setNotice(null);
                    }}
                  />
                </label>

                <label className="field">
                  <span>Voice instructions</span>
                  <small>Describe tone, structure, and wording. Be specific enough to reuse.</small>
                  <textarea
                    aria-label="Voice instructions"
                    disabled={busy}
                    maxLength={4000}
                    rows={9}
                    placeholder="Write plainly, avoid exclamation marks, and ask one useful question."
                    value={instruction}
                    onChange={(event) => {
                      setInstruction(event.target.value);
                      setNotice(null);
                    }}
                  />
                </label>

                <p className="reply-voice-boundary">
                  A voice can guide style, but it cannot make a draft open with your product or
                  invent facts about it.
                </p>

                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                {notice && (
                  <p className="reply-voice-notice" role="status">
                    <span className="reply-voice-notice-icon" aria-hidden="true">
                      ✓
                    </span>
                    {notice}
                  </p>
                )}
              </div>

              <footer className="reply-voice-actions">
                <div>
                  {selected && !confirmingDelete && (
                    <button
                      className="reply-voice-delete"
                      disabled={busy}
                      type="button"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      Delete voice
                    </button>
                  )}
                  {selected && confirmingDelete && (
                    <div className="reply-voice-delete-confirm">
                      <span>Delete “{selected.name}”?</span>
                      <button
                        className="reply-voice-delete"
                        disabled={busy}
                        type="button"
                        onClick={() => void remove()}
                      >
                        Yes, delete
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    type="button"
                    onClick={cancel}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary-button"
                    disabled={busy || !name.trim() || !instruction.trim()}
                    type="submit"
                  >
                    {busy ? "Saving…" : selected ? "Save changes" : "Create voice"}
                  </button>
                </div>
              </footer>
            </form>
          ) : (
            <div className="reply-voice-empty">
              <span className="reply-voice-empty-icon" aria-hidden="true">
                ✦
              </span>
              <h2>Create your first reply voice</h2>
              <p>Save the writing guidance you want available across every project.</p>
              <button className="primary-button" type="button" onClick={startNew}>
                Create a voice
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
