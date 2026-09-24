/**
 * The mark in the email header. US-095.
 *
 * The PNG is generated from `packages/ui/src/assets/mark.svg` and committed,
 * because this package may not import the UI package. This is what notices
 * when the SVG moves and the committed PNG does not.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emailMarkPng } from "./email-mark.js";
import { emailMarkModule, markSource, renderEmailMark } from "./email-mark-generate.js";
import { emailMarkCid, renderShell } from "./email-theme.js";

describe("the email mark", () => {
  it("is the file the generator writes from the canonical SVG today", () => {
    const committed = readFileSync(new URL("./email-mark.ts", import.meta.url), "utf8");

    expect(committed).toBe(emailMarkModule(readFileSync(markSource, "utf8")));
  });

  it("is a small square PNG, because every message carries it", () => {
    const bytes = Buffer.from(emailMarkPng, "base64");

    expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(64);
    expect(bytes.readUInt32BE(20)).toBe(64);
    expect(bytes.length).toBeLessThan(2_000);
  });

  it("refuses an SVG with more than circles, rather than drawing part of it", () => {
    const svg = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

    expect(() => renderEmailMark(svg)).toThrow(/more than circles: rect/);
  });
});

describe("the email header", () => {
  const html = renderShell({ preheading: "A match.", body: "", footer: "Footer." });

  it("shows the attached mark beside the wordmark", () => {
    expect(html).toContain(`src="cid:${emailMarkCid}"`);
    expect(html).toContain('width="32" height="32"');
  });

  it("still says who wrote when images are off", () => {
    // The alt is empty so a blocked image adds no text, and the name is text.
    expect(html).toContain('alt=""');
    expect(html).toMatch(/>SignalScout</);
  });
});
