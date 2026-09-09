/**
 * The dressed email. US-094.
 *
 * Correctness-critical, and the failure shape is a stranger's words becoming
 * markup in somebody's mail client. A digest is built entirely from things this
 * product did not write — a post title, an excerpt, an author name, a model's
 * reasons, a URL a provider returned — and every one of them is interpolated
 * into HTML. US-064 learned the same lesson about spreadsheet formulas built
 * from the same content.
 *
 * The rest of the file is about what a mail client can render: a `<style>`
 * block Gmail strips, a flex row Outlook flattens, a font nobody has.
 */
import { describe, expect, it } from "vitest";
import { escapeHtml, safeUrl } from "./email-theme.js";
import { type MatchRow, matchEmail } from "./match-email.js";

const postedAt = new Date("2026-09-09T12:00:00.000Z");
const now = new Date("2026-09-10T00:00:00.000Z");

function row(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    score: 71,
    reasons: ["A QA lead asks what to automate first"],
    source: "reddit",
    url: "https://www.reddit.com/r/softwaretesting/comments/example/",
    excerpt: "Joining a company with no automation at all. Where would you start?",
    author: "tester",
    postedAt,
    ...overrides,
  };
}

function render(rows: readonly MatchRow[], appUrl?: string) {
  return matchEmail({
    monitorName: "QA conversations",
    matches: rows,
    kind: rows.length === 1 ? "match" : "digest",
    appUrl,
    now,
  });
}

describe("a stranger's words never become markup", () => {
  it("escapes a post that carries a script tag", () => {
    const nasty = render([
      row({
        excerpt: '<script>alert("x")</script>',
        author: '<img src=x onerror="alert(1)">',
        reasons: ['it says <b>"buy"</b>'],
      }),
    ]);

    // The dangerous forms, not the words. `onerror=` survives as text inside
    // `&lt;img src=x onerror=&quot;…&gt;`, which is exactly what escaping is
    // supposed to leave behind.
    expect(nasty.html).not.toContain("<script>");
    expect(nasty.html).not.toContain("<img");
    expect(nasty.html).toContain("&lt;script&gt;");
    expect(nasty.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(nasty.html).toContain("&lt;b&gt;&quot;buy&quot;&lt;/b&gt;");
  });

  it("escapes the monitor's own name, which a person typed", () => {
    const named = matchEmail({
      monitorName: "</td><script>alert(1)</script>",
      matches: [row()],
      kind: "match",
      now,
    });

    expect(named.html).not.toContain("<script>");
    expect(named.html).toContain("&lt;script&gt;");
  });

  it("refuses a javascript: URL an href, and shows it as text instead", () => {
    // A post URL arrives from a provider, and a provider's answer is not ours.
    // eslint-disable-next-line no-script-url
    const dodgy = render([row({ url: "javascript:alert(1)" })]);

    expect(dodgy.html).not.toContain('href="javascript:');
    expect(dodgy.html).toContain("javascript:alert(1)");
    expect(dodgy.html).not.toContain("Read the conversation");
  });

  it("keeps an ordinary link", () => {
    expect(render([row()]).html).toContain(
      'href="https://www.reddit.com/r/softwaretesting/comments/example/"',
    );
  });

  it("escapes the five characters that matter and nothing else", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
    expect(escapeHtml("plain words")).toBe("plain words");
  });

  it("allows only http and https through safeUrl", () => {
    expect(safeUrl("https://example.test/a")).toBe("https://example.test/a");
    expect(safeUrl("http://example.test/a")).toBe("http://example.test/a");
    // eslint-disable-next-line no-script-url
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<script>")).toBeNull();
    expect(safeUrl("/relative")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
  });
});

describe("what the message says", () => {
  it("keeps the subject a mail filter was written against", () => {
    expect(render([row(), row()]).subject).toBe("SignalScout: 2 matches for QA conversations");
    expect(render([row()]).subject).toBe("SignalScout: 1 match for QA conversations");
  });

  it("keeps the plain text beside the HTML, losing nothing", () => {
    // A text-only client and a screen reader read this one, and a multipart
    // message scores better with a spam filter than an HTML-only one.
    const { text, html } = render([row()]);

    expect(text).toContain("Score: 71");
    expect(text).toContain("Joining a company with no automation at all.");
    expect(text).toContain("https://www.reddit.com/r/softwaretesting/comments/example/");
    expect(html).not.toBe("");
  });

  it("says how old the post is, in the words a person would use", () => {
    const html = render([row({ postedAt: new Date("2026-09-09T23:30:00.000Z") })]).html;

    expect(html).toContain("reddit · @tester · 1h ago");
  });

  it("leaves the author out when the platform gave none", () => {
    expect(render([row({ author: null })]).html).toContain("reddit · 12h ago");
  });

  it("offers the inbox button only where the instance says where it answers", () => {
    // `APP_URL` is required only for Stripe, so a self-hosted deployment may
    // have none — and a button pointing nowhere is worse than no button.
    expect(render([row()], "https://app.example.test").html).toContain("Open the inbox");
    expect(render([row()]).html).not.toContain("Open the inbox");
  });
});

describe("what a mail client can actually render", () => {
  const html = render([row()], "https://app.example.test").html;

  it("lays out with tables, because Outlook lays out with Word", () => {
    expect(html).toContain("<table");
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("display:grid");
  });

  it("carries no stylesheet, because several clients strip one", () => {
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<link");
  });

  it("loads nothing from anywhere: no image, no font, no tracking pixel", () => {
    expect(html).not.toContain("<img");
    expect(html).not.toContain("@font-face");
    expect(html).not.toContain("fonts.googleapis");
    // Figtree is the site font and no mail client will fetch it, so naming it
    // would invite somebody to add a @font-face that cannot work.
    expect(html).not.toContain("Figtree");
  });

  it("closes every style attribute it opens", () => {
    /**
     * The fault this file was written with. Every style is inside a
     * double-quoted attribute, so a double quote in a value — `"Segoe UI"` in
     * the font stack — ends the attribute early and turns the rest of the
     * declaration into stray attributes on the tag.
     */
    for (const style of html.matchAll(/style="([^"]*)"/g)) {
      expect(style[1]).not.toContain('"');
    }

    // An odd number of quote characters means one attribute never closed.
    expect((html.match(/"/g) ?? []).length % 2).toBe(0);
    expect(html).not.toContain('"Segoe UI"');
  });

  it("paints its own background, so a dark-mode client does not invert it", () => {
    expect(html).toContain("color-scheme:light");
    expect(html).toContain("background:#f7f8fa");
  });

  it("uses the site's own accent, copied from the tokens", () => {
    expect(html).toContain("#36578f");
    expect(html).toContain("#48679f");
  });
});
