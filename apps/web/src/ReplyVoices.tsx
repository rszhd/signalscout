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

/** A voice somebody can start from, as the server offers it. US-065. */
interface VoicePreset {
  id: string;
  name: string;
  instruction: string;
  why: string;
}

/**
 * Voices to start from.
 *
 * Shown wherever a person is making a *new* voice — the empty state and the
 * new-voice form both. The first version put them only on the empty state,
 * which hid them from the one person most likely to want them: somebody who
 * has written one voice and wants a few more.
 *
 * Never shown while editing a saved voice, because there the button would
 * silently replace words somebody already wrote.
 */
function VoicePresets({
  presets,
  saved,
  busy,
  onAdd,
}: {
  presets: VoicePreset[];
  /** Names already saved, so a preset somebody has is not offered again. */
  saved: string[];
  busy: boolean;
  onAdd: (preset: VoicePreset) => void;
}) {
  const taken = new Set(saved.map((name) => name.trim().toLowerCase()));
  const offered = presets.filter((preset) => !taken.has(preset.name.trim().toLowerCase()));

  if (offered.length === 0) return null;

  return (
    <div className="reply-voice-presets">
      <header>
        <h2>Add a voice</h2>
        <span>{offered.length}</span>
      </header>
      <ul>
        {offered.map((preset) => (
          <li key={preset.id}>
            <button disabled={busy} type="button" onClick={() => onAdd(preset)}>
              <span className="reply-voice-preset-name">{preset.name}</span>
              {/*
                Each says why it exists. A preset somebody does not understand
                is one they cannot edit sensibly.
              */}
              <span className="reply-voice-preset-why">{preset.why}</span>
              <span className="reply-voice-preset-add" aria-hidden="true">
                Add
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReplyVoices() {
  const [voices, setVoices] = useState<ReplyVoice[] | null>(null);
  const [presets, setPresets] = useState<VoicePreset[]>([]);
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

    // Separately, and its failure is silent: presets are a way to start, not a
    // way to work. Losing them must not take the blank form away.
    requestJson<{ presets: VoicePreset[] }>("/api/reply-prompts/presets")
      // The shape is checked rather than trusted. A route answering something
      // unexpected must leave the blank form working, not throw inside a
      // render — presets are a way to start and not a way to work.
      .then(({ presets: offered }) => setPresets(Array.isArray(offered) ? offered : []))
      .catch(() => {});
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

  /**
   * Add a preset as a saved voice, in one press.
   *
   * It saves rather than filling the form, and the button says "Add" so that
   * is what a person expects. The first version only filled the fields, which
   * made "add a few more voices" into a form to complete five times — and the
   * presets were invisible until somebody pressed New voice, so nobody would
   * have found them at all.
   *
   * The new voice is then opened for editing, because a preset is a starting
   * point and the edit is the point.
   */
  async function addPreset(preset: VoicePreset): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const created = await requestJson<ReplyVoice>("/api/reply-prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: preset.name, instruction: preset.instruction }),
      });

      const { prompts } = await requestJson<{ prompts: ReplyVoice[] }>("/api/reply-prompts");
      setVoices(prompts);
      choose(created);
      setNotice(`Added “${created.name}”. Edit it to make it yours.`);
    } catch (cause) {
      setError(messageFor(cause, "That voice could not be added."));
    } finally {
      setBusy(false);
    }
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

          {/*
            Under the saved list, because that is where somebody counting their
            voices is looking. Buried behind New voice they were invisible: the
            page said "Saved voices 1" and the five may as well not have
            shipped.
          */}
          <VoicePresets
            presets={presets}
            saved={voices.map((voice) => voice.name)}
            busy={busy}
            onAdd={(preset) => void addPreset(preset)}
          />
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

              {/*
                Presets, on the empty state where they are needed most. US-065.
                A person who has never written an instruction does not know what
                a good one looks like, and the ones they guess at tend to ask
                for the thing the prompt refuses. Each says why it exists,
                because a preset somebody does not understand is one they cannot
                edit sensibly.
              */}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
