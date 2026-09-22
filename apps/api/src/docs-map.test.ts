/**
 * Every path `docs/map.md` names is a path that exists.
 *
 * The map is the one page written for a person arriving for the first time,
 * and its whole value is that it says where things are. A renamed file makes
 * it a liar quietly: nothing imports it, nothing type-checks it, and the next
 * newcomer follows it into a folder that is not there. US-301.
 *
 * The map writes some paths in full and some as a readable tail —
 * `worker/collect.ts` rather than `packages/pipeline/src/worker/collect.ts`.
 * So a span passes when a real path ends with it, which is the same thing a
 * reader does with it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const map = readFileSync(new URL("docs/map.md", root), "utf8");

const walk = (dir: string, prefix = ""): string[] =>
  readdirSync(fileURLToPath(new URL(dir, root)), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) {
      return [];
    }
    const here = `${prefix}${entry.name}`;
    return entry.isDirectory() ? [here, ...walk(`${dir}${entry.name}/`, `${here}/`)] : [here];
  });

const everyPath = ["apps/", "packages/", "docs/", "scripts/", "backlog/"].flatMap((dir) =>
  walk(dir, dir),
);

/** A backticked span with a slash in it, and no space: `worker/collect.ts`. */
const spans = [...map.matchAll(/`([^`\s]+\/[^`\s]+)`/g)].flatMap((match) => match[1] ?? []);

/** Relative links, minus anchors and external URLs. */
const links = [...map.matchAll(/\]\((?!https?:)([^)#]+)/g)].flatMap((match) => match[1] ?? []);

describe("docs/map.md", () => {
  it("names paths that exist", () => {
    expect(spans.length).toBeGreaterThan(12);
    const missing = spans.filter(
      (span) => !everyPath.some((path) => path === span || path.endsWith(`/${span}`)),
    );
    expect(missing).toEqual([]);
  });

  it("links files that exist", () => {
    expect(links.length).toBeGreaterThan(5);
    const missing = links.filter((link) => !existsSync(new URL(link, new URL("docs/", root))));
    expect(missing).toEqual([]);
  });

  it("stays short enough to read in one sitting", () => {
    const words = map.split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThan(800);
  });
});
