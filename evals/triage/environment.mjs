/** The instance's AI settings, read once from `.env`, for the providers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function environment() {
  let file = {};
  try {
    file = Object.fromEntries(
      readFileSync(join(here, "../../.env"), "utf8")
        .split("\n")
        .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
        .map((line) => [
          line.slice(0, line.indexOf("=")).trim(),
          line
            .slice(line.indexOf("=") + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        ]),
    );
  } catch {
    file = {};
  }

  const merged = {};
  // An empty value is unset, the way `blankIsUnset` treats it in the engine's
  // schema. Passing "" through instead priced a whole run at zero.
  for (const [name, value] of Object.entries({ ...file, ...process.env })) {
    if (value !== "") merged[name] = value;
  }

  return { ...merged, AI_TIMEOUT_MS: Number(merged.AI_TIMEOUT_MS ?? 30_000) };
}
