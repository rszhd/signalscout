/**
 * Reading a document from a URL or an upload. US-050.
 *
 * **Correctness-critical: a server talked into fetching its own network.**
 * The failure shape is a person pasting `https://…` that resolves to
 * `169.254.169.254` and getting cloud credentials back in a form field, or
 * pointing this at `localhost` and reading whatever answers. Every refusal
 * below is a hole that would otherwise be open, so a red case here is a
 * security regression rather than a tidiness one.
 *
 * No network: the fetch and the address check are both injected, which is what
 * lets every branch be driven — including the ones a real network would not
 * produce on demand, like a public host redirecting to a private one.
 */
import { describe, expect, it, vi } from "vitest";
import {
  acceptedTextTypes,
  fetchDocument,
  isPrivateAddress,
  maximumRedirects,
  readUploadedDocument,
} from "./document.js";

/** A fetch that answers one page, and records what it was asked for. */
function serving(pages: Record<string, { status?: number; type?: string; body?: string }>) {
  const asked: string[] = [];

  const fetchImpl = (async (input: URL | string) => {
    const url = String(input);
    asked.push(url);

    const page = pages[url] ?? pages["*"];
    if (!page) throw new Error(`nothing serving ${url}`);

    return new Response(page.body ?? "hello", {
      status: page.status ?? 200,
      headers: { "content-type": page.type ?? "text/plain" },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, asked };
}

/** Every hostname allowed, so a case can be about something else. */
const anywhere = async () => true;

describe("which addresses are private", () => {
  it("refuses the ranges that make a fetch feature a credential leak", () => {
    // The metadata service first: it is the reason this function exists.
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.0.0.5")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("0.0.0.0")).toBe(true);
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    // An IPv4 private address wearing an IPv6 hat.
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("allows the ranges the internet actually lives in", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("192.169.0.1")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });
});

describe("reading a document from a URL", () => {
  it("reads a page and hands back its text", async () => {
    const { fetchImpl } = serving({ "*": { body: "We sell a test runner." } });

    const result = await fetchDocument("https://example.test/about", {
      fetchImpl,
      allowAddress: anywhere,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain("test runner");
  });

  /**
   * The option that makes the redirect check possible at all.
   *
   * A fake `fetch` cannot follow a redirect, so no case here can tell
   * `redirect: "manual"` from `"follow"` by its result — the difference only
   * appears against a real network, where "follow" would take the hop and
   * never let our code see it. What is assertable is what we asked for, so
   * that is what this asserts.
   */
  it("asks fetch not to follow redirects itself", async () => {
    const seen: RequestInit[] = [];

    const recording = (async (_input: URL | string, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response("hello", { status: 200, headers: { "content-type": "text/plain" } });
    }) as unknown as typeof fetch;

    await fetchDocument("https://example.test/", { fetchImpl: recording, allowAddress: anywhere });

    expect(seen[0]?.redirect).toBe("manual");
    // And a timeout, so a slow host cannot hold the request open.
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses anything that is not https, without asking the network", async () => {
    const { fetchImpl, asked } = serving({ "*": {} });

    for (const url of ["http://example.test/", "file:///etc/passwd", "gopher://example.test/"]) {
      const result = await fetchDocument(url, { fetchImpl, allowAddress: anywhere });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe("scheme");
    }

    // Nothing was fetched. A refusal that still made the request would have
    // already done the thing it was refusing.
    expect(asked).toEqual([]);
  });

  it("refuses a hostname that resolves to this network, and fetches nothing", async () => {
    const { fetchImpl, asked } = serving({ "*": {} });

    const result = await fetchDocument("https://localtest.me/", {
      fetchImpl,
      // The whole point: the name is public and the address is not.
      allowAddress: async () => false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("address");
    expect(asked).toEqual([]);
  });

  /**
   * The attack this module exists for.
   *
   * A public host answers 302 to the metadata service. `redirect: "follow"`
   * would take it and never check, so redirects are walked by hand and every
   * hop is checked again.
   */
  it("checks the address again on every redirect", async () => {
    const { fetchImpl, asked } = serving({
      "https://example.test/": {
        status: 302,
        body: "",
      },
      "*": { body: "secrets" },
    });

    const allowAddress = vi.fn(async (hostname: string) => hostname === "example.test");

    const redirecting = (async (input: URL | string) => {
      const url = String(input);
      asked.push(url);

      if (url === "https://example.test/") {
        return new Response("", {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data/" },
        });
      }

      return new Response("secrets", { status: 200, headers: { "content-type": "text/plain" } });
    }) as unknown as typeof fetch;

    const result = await fetchDocument("https://example.test/", {
      fetchImpl: redirecting,
      allowAddress,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("address");

    // The first hop was fetched and the second was not.
    expect(asked).toEqual(["https://example.test/"]);
    expect(allowAddress).toHaveBeenCalledWith("169.254.169.254");
    void fetchImpl;
  });

  it("gives up rather than following redirects for ever", async () => {
    let hops = 0;

    const looping = (async () => {
      hops += 1;
      return new Response("", {
        status: 302,
        headers: { location: `https://example.test/${hops}` },
      });
    }) as unknown as typeof fetch;

    const result = await fetchDocument("https://example.test/", {
      fetchImpl: looping,
      allowAddress: anywhere,
    });

    expect(result.ok).toBe(false);
    expect(hops).toBeLessThanOrEqual(maximumRedirects + 1);
  });

  it("refuses a page that is not text, naming what it was", async () => {
    const { fetchImpl } = serving({ "*": { type: "application/zip" } });

    const result = await fetchDocument("https://example.test/x.zip", {
      fetchImpl,
      allowAddress: anywhere,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("type");
      // Named, so a person can act. "Could not read" is not a sentence.
      expect(result.failure.message).toContain("application/zip");
    }
  });

  it("reports what the page answered rather than saying it failed", async () => {
    const { fetchImpl } = serving({ "*": { status: 404 } });

    const result = await fetchDocument("https://example.test/gone", {
      fetchImpl,
      allowAddress: anywhere,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("status");
      expect(result.failure.message).toContain("404");
    }
  });

  it("tells an unreachable host apart from a refused one", async () => {
    const failing = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;

    const result = await fetchDocument("https://example.test/", {
      fetchImpl: failing,
      allowAddress: anywhere,
    });

    expect(result.ok).toBe(false);
    // Three different situations, three different words: a private address, a
    // host that will not answer, and a page that answered badly.
    if (!result.ok) expect(result.failure.kind).toBe("unreachable");
  });

  it("strips the markup out of a page, keeping its words", async () => {
    const { fetchImpl } = serving({
      "*": {
        type: "text/html",
        body: "<html><head><style>a{color:red}</style><script>alert(1)</script></head><body><h1>Acme QA</h1><p>Tests break on every&nbsp;UI change.</p></body></html>",
      },
    });

    const result = await fetchDocument("https://example.test/", {
      fetchImpl,
      allowAddress: anywhere,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("Acme QA");
      expect(result.text).toContain("Tests break on every UI change.");
      // The parts of a page that are not words about the product.
      expect(result.text).not.toContain("alert(1)");
      expect(result.text).not.toContain("color:red");
      expect(result.text).not.toContain("<");
    }
  });
});

describe("reading an uploaded document", () => {
  it("reads the types it accepts", async () => {
    for (const type of acceptedTextTypes) {
      const result = readUploadedDocument("We sell a test runner.", type);
      expect(result.ok).toBe(true);
    }
  });

  it("says what to do about a PDF rather than only refusing it", () => {
    const result = readUploadedDocument("%PDF-1.7", "application/pdf");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("type");
      // A refusal a person can act on. PDF is unsupported because parsing one
      // needs a dependency nobody has asked for yet.
      expect(result.failure.message).toContain("PDF");
      expect(result.failure.message).toContain("instead");
    }
  });

  it("names an unsupported type instead of guessing at it", () => {
    const result = readUploadedDocument("PK", "application/zip");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.message).toContain("application/zip");
  });
});
