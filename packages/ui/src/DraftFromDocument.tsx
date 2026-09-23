import { useState } from "react";
import { messageFor, requestJson } from "./api.js";
import { FormError } from "./components/FormError.js";

/**
 * Draft a project's four answers from a page or a file. US-354.
 *
 * The file is read here rather than uploaded, so the only thing that reaches
 * `/api/projects/describe` is its text: no multipart, no filename to
 * sanitise, no temp file.
 *
 * **What comes back is a draft and not a decision.** The four fields are the
 * ones the classifier reads, so they are filled in for a person to read, edit
 * and save; nothing here writes anything. Where it sits — the project form
 * self-hosted, the first step of the monitor flow hosted — is the page's.
 */
export interface DraftedProject {
  name: string;
  product: string;
  idealCustomer: string;
  problem: string;
  missing: string[];
  charactersRead: number;
  truncated: boolean;
}

export interface DraftFromDocumentProps {
  readonly onDrafted: (draft: DraftedProject) => void;
  readonly disabled: boolean;
  readonly onBusy: (busy: boolean) => void;
}

export function DraftFromDocument({ onDrafted, disabled, onBusy }: DraftFromDocumentProps) {
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
      // The server's own sentence names the host, the status or the file
      // type: the part a person can act on.
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
