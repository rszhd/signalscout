/**
 * Every font weight the package's rules ask for is one it loads. US-369.
 *
 * `tokens.css` sets `font-synthesis: none`, so a weight with no face is drawn
 * with the next heavier one, silently. That is how 600 became 700 in one
 * application for weeks: nothing fails, the type is only heavier. This file
 * is the failure.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = fileURLToPath(new URL("./styles/", import.meta.url));

const keywords: Record<string, number> = { normal: 400, bold: 700 };

/** Every weight a stylesheet asks for, with the file and the value. */
function weightsIn(css: string): number[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/font-weight:\s*([a-z0-9]+)/g)]
    .map((match) => match[1] ?? "")
    .map((value) => keywords[value] ?? Number(value))
    .filter((value) => Number.isFinite(value));
}

/** The weights `fonts.css` loads, read from its face imports. */
function loadedIn(css: string): number[] {
  return [...css.matchAll(/@import "@fontsource\/[a-z-]+\/latin-(\d+)\.css"/g)].map((match) =>
    Number(match[1]),
  );
}

describe("the package's font weights", () => {
  it("loads every weight its stylesheets ask for", async () => {
    const loaded = new Set(loadedIn(await readFile(join(styles, "fonts.css"), "utf8")));
    const files = (await readdir(styles)).filter((name) => name.endsWith(".css"));

    const missing: string[] = [];
    for (const file of files) {
      for (const weight of weightsIn(await readFile(join(styles, file), "utf8"))) {
        if (!loaded.has(weight)) missing.push(`${file} asks for ${weight}`);
      }
    }

    expect(loaded.size).toBeGreaterThan(0);
    expect([...new Set(missing)]).toEqual([]);
  });

  it("would catch a weight nobody loaded", () => {
    const loaded = new Set(loadedIn('@import "@fontsource/figtree/latin-400.css";'));
    const asked = weightsIn(".a { font-weight: 800; } .b { font-weight: normal; }");

    expect(asked.filter((weight) => !loaded.has(weight))).toEqual([800]);
  });
});
