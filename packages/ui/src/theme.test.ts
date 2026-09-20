import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Rules in `theme.css` that a page once overrode for a reason that no longer
 * holds. US-283: the open app's `.brand-logo` kept a radius from the old
 * square logo, and it cut a flat edge into the blue dot of the nine-dot mark,
 * whose corner dots touch the edge of the drawing.
 */
const theme = await readFile(fileURLToPath(new URL("./styles/theme.css", import.meta.url)), "utf8");

describe("theme.css", () => {
  it("styles the mark once, without a clip or a fixed size", () => {
    const rules = [...theme.matchAll(/\.brand-logo\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
    expect(rules).toHaveLength(1);
    expect(rules[0]).not.toMatch(/border-radius|clip-path|overflow/);
    expect(rules[0]).not.toMatch(/\b(width|height)\s*:/);
  });
});
