/**
 * Getting a document's text, from a URL or from bytes somebody uploaded.
 *
 * US-050. This is the half with a security cost, and it is separate from
 * `ai/describe.ts` on purpose: what the model does with text is one problem,
 * and what our server will go and fetch on a stranger's say-so is another.
 *
 * **A server that fetches whatever URL it is handed is a hole.** It will fetch
 * `http://169.254.169.254/` and hand back cloud credentials, or
 * `http://localhost:5432` and report what Postgres said, or walk a redirect
 * from a public host to a private one. This product is self-hosted and
 * single-account until US-017, so today the person asking is the person who
 * owns the machine — and that is a reason to write the guard now, while it is
 * cheap, rather than a reason to skip it.
 *
 * Five rules, and the fourth is the one people miss:
 *
 * 1. `https` only. No `file:`, no `http:`, no `gopher:`.
 * 2. A timeout, so a slow host cannot hold a request open.
 * 3. A size cap, applied while reading rather than after.
 * 4. **Addresses are checked after DNS resolution, at every hop.** A hostname
 *    is not an address: `localtest.me` resolves to 127.0.0.1, and a public
 *    host can redirect to a private one.
 * 5. A redirect limit, each one re-checked.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Long enough for a slow page, short enough that nobody watches a spinner. */
export const fetchTimeoutMs = 10_000;

/**
 * The most bytes read from a URL or accepted from an upload.
 *
 * Two megabytes is a very large landing page and a small PDF. The model only
 * ever sees `maximumDocumentCharacters` of it, so this cap is about what
 * crosses the network and what sits in memory, not about the bill.
 */
export const maximumDocumentBytes = 2_000_000;

/** Enough to follow a canonical redirect, not enough to be walked somewhere. */
export const maximumRedirects = 3;

/**
 * What this will read.
 *
 * PDF is deliberately absent: parsing one needs a dependency, and adding one
 * unasked is worse than saying plainly that a PDF is not yet supported. The
 * message names the type so a person can convert it rather than guess.
 */
export const acceptedTextTypes = ["text/plain", "text/markdown", "text/html"] as const;

export type DocumentFailure =
  | { readonly kind: "scheme"; readonly message: string }
  | { readonly kind: "address"; readonly message: string }
  | { readonly kind: "unreachable"; readonly message: string }
  | { readonly kind: "status"; readonly message: string }
  | { readonly kind: "type"; readonly message: string }
  | { readonly kind: "tooLarge"; readonly message: string };

export type DocumentResult =
  | {
      readonly ok: true;
      readonly text: string;
      readonly bytes: number;
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly failure: DocumentFailure };

/**
 * Whether an address is one this server must never be talked into reaching.
 *
 * Loopback, private, link-local, unique-local and unspecified. The
 * link-local range is the one that matters most: `169.254.169.254` is the
 * cloud metadata service, and reaching it is how a fetch feature becomes a
 * credential leak.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a = 0, b = 0] = parts;

    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    // Carrier-grade NAT, and the ranges nothing public lives in.
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;

    return false;
  }

  if (version === 6) {
    const plain = address.toLowerCase().replace(/^\[|\]$/g, "");

    if (plain === "::1" || plain === "::") return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(plain)) return true;
    if (/^fe[89ab]/.test(plain)) return true;
    // An IPv4 address wearing an IPv6 hat.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(plain);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);

    return false;
  }

  return false;
}

/** Resolve a hostname and refuse it if any address it answers with is private. */
async function addressIsAllowed(hostname: string): Promise<boolean> {
  const bare = hostname.replace(/^\[|\]$/g, "");

  // Already an address: no lookup, same rule.
  if (isIP(bare) !== 0) return !isPrivateAddress(bare);

  try {
    const found = await lookup(bare, { all: true });
    // Every address, not the first: a host answering with one public and one
    // private address is a host that can be raced into the private one.
    return found.length > 0 && found.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}

function textFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export interface FetchDocumentOptions {
  /** Injected so a test can drive every branch without a network. */
  readonly fetchImpl?: typeof fetch;
  readonly allowAddress?: (hostname: string) => Promise<boolean>;
}

/**
 * Read a document from a URL, refusing everything the rules above name.
 *
 * Redirects are followed by hand rather than by `fetch`, because each hop
 * needs its own address check — a public host that redirects to
 * `http://169.254.169.254/` is the whole attack, and `redirect: "follow"`
 * would take it.
 */
export async function fetchDocument(
  rawUrl: string,
  { fetchImpl = fetch, allowAddress = addressIsAllowed }: FetchDocumentOptions = {},
): Promise<DocumentResult> {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, failure: { kind: "scheme", message: "That is not a URL." } };
  }

  for (let hop = 0; hop <= maximumRedirects; hop += 1) {
    if (url.protocol !== "https:") {
      return {
        ok: false,
        failure: {
          kind: "scheme",
          message: `Only https addresses can be read, and that one is ${url.protocol.replace(":", "")}.`,
        },
      };
    }

    if (!(await allowAddress(url.hostname))) {
      return {
        ok: false,
        failure: {
          kind: "address",
          message: `${url.hostname} resolves to an address on this network, which cannot be read.`,
        },
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);

    let response: Response;

    try {
      response = await fetchImpl(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "text/html,text/plain,text/markdown" },
      });
    } catch (cause) {
      return {
        ok: false,
        failure: {
          kind: "unreachable",
          message: `${url.hostname} could not be reached: ${cause instanceof Error ? cause.message : "no answer"}.`,
        },
      };
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");

      if (!next) {
        return {
          ok: false,
          failure: { kind: "status", message: `${url.hostname} redirected to nowhere.` },
        };
      }

      url = new URL(next, url);
      continue;
    }

    if (!response.ok) {
      return {
        ok: false,
        failure: { kind: "status", message: `That page answered ${response.status}.` },
      };
    }

    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";

    if (!acceptedTextTypes.includes(contentType as (typeof acceptedTextTypes)[number])) {
      return {
        ok: false,
        failure: {
          kind: "type",
          message: `That page is ${contentType || "an unknown type"}, and only text and HTML can be read.`,
        },
      };
    }

    const body = await response.text();
    const bytes = Buffer.byteLength(body, "utf8");
    const cut = bytes > maximumDocumentBytes;
    const usable = cut ? body.slice(0, maximumDocumentBytes) : body;

    return {
      ok: true,
      text: contentType === "text/html" ? textFromHtml(usable) : usable,
      bytes,
      truncated: cut,
    };
  }

  return {
    ok: false,
    failure: { kind: "status", message: "That address redirected too many times." },
  };
}

/**
 * Read a document from bytes somebody uploaded.
 *
 * No network and no DNS, which is why the ticket says to ship this half first.
 * The type is what the caller says it is; the size is checked here because a
 * caller that forgot would be a caller holding two megabytes it never meant to.
 */
export function readUploadedDocument(body: string, contentType: string): DocumentResult {
  const type = contentType.split(";")[0]?.trim() ?? "";

  if (!acceptedTextTypes.includes(type as (typeof acceptedTextTypes)[number])) {
    return {
      ok: false,
      failure: {
        kind: "type",
        message:
          type === "application/pdf"
            ? "PDF is not supported yet. Save the page as text or paste its address instead."
            : `${type || "That file"} cannot be read. Use plain text, Markdown or HTML.`,
      },
    };
  }

  const bytes = Buffer.byteLength(body, "utf8");
  const cut = bytes > maximumDocumentBytes;
  const usable = cut ? body.slice(0, maximumDocumentBytes) : body;

  return {
    ok: true,
    text: type === "text/html" ? textFromHtml(usable) : usable,
    bytes,
    truncated: cut,
  };
}
