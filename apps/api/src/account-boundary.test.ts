/**
 * Every pipeline function this application calls with the database names the
 * account it acts for. US-336.
 *
 * Correctness-critical, as part of the session gate. The failure shape is
 * BUG-009 and BUG-330: a route that checked its owner in one read and not in
 * the next, answering a stranger with somebody else's row, and looking normal
 * doing it. A check each route has to remember is kept by review; this keeps
 * it by failing. A function passes when it takes `userId`, or when its input
 * type requires one. Anything else is in `instanceWide` below, with the reason
 * it may read past one account.
 *
 * The worker calls the unchecked twins — `getMonitor`, `checkBudget` — because
 * it polls every account. This reads only `apps/api`'s own source.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const apiSource = fileURLToPath(new URL("./", import.meta.url));
const pipelineSource = fileURLToPath(new URL("../../../packages/pipeline/src/", import.meta.url));

/** The functions allowed to read or change more than one account's rows. */
const instanceWide: Record<string, string> = {
  allStoredCredentialNames: "The boot check: which credential names the instance stores.",
  assertStoredCredentialsAreReadable: "The boot check: the key opens every stored secret.",
  budgetStates: "Every monitor's spend in one read; the route keeps its own rows (US-333).",
  classifiedPostCounts: "Counts for the monitor ids the caller passes from a scoped read.",
  filterDropCounts: "Counts for the monitor ids the caller passes from a scoped read.",
  matchCounts: "Counts for the monitor ids the caller passes from a scoped read.",
  verdictCounts: "Counts for the monitor ids the caller passes from a scoped read.",
  lastCollections: "Every monitor's last collection; the route keeps its own rows (US-333).",
  notificationIssues: "Every monitor's delivery errors; the route keeps its own rows.",
  refuseEstimate: "Changes the estimate row the same request has just created.",
};

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
    }),
  );
  return files.flat();
}

async function sources(directory: string): Promise<string> {
  const files = await sourceFiles(directory);
  return (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
}

/**
 * The parameter list that starts at the first `(` after `from`, split at its
 * top-level commas. A default such as `new Date()` or a type such as
 * `Record<string, string>` holds brackets and commas of its own.
 */
function parameters(source: string, from: number): string[] {
  const open = source.indexOf("(", from);
  const list: string[] = [];
  let depth = 0;
  let current = "";

  for (let index = open; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const arrow = character === ">" && source[index - 1] === "=";

    if ("([{<".includes(character)) {
      depth += 1;
      if (depth === 1) continue;
    } else if (")]}>".includes(character) && !arrow) {
      depth -= 1;
      if (depth === 0) {
        list.push(current);
        break;
      }
    } else if (character === "," && depth === 1) {
      list.push(current);
      current = "";
      continue;
    }
    current += character;
  }

  return list.map((parameter) => parameter.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Every exported function of the pipeline, by name, with its parameters. */
function pipelineFunctions(source: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const match of source.matchAll(/export (?:async )?function (\w+)/g)) {
    found.set(match[1] ?? "", parameters(source, (match.index ?? 0) + match[0].length));
  }
  return found;
}

/** Whether an interface, or one it extends, requires `readonly userId: string`. */
function requiresUser(source: string, name: string): boolean {
  const declaration = new RegExp(`export interface ${name}\\b([^{]*)\\{([\\s\\S]*?)\\n\\}`).exec(
    source,
  );
  if (!declaration) return false;

  const [, heritage = "", body = ""] = declaration;
  if (/^\s*readonly userId: string;/m.test(body)) return true;

  const parents = /extends ([\w\s,]+)/.exec(heritage)?.[1]?.split(",") ?? [];
  return parents.some((parent) => requiresUser(source, parent.trim()));
}

/** The values `apps/api` imports from the pipeline. Types carry no query. */
function importedFromPipeline(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["']@signalscout\/pipeline["']/g,
  )) {
    for (const specifier of (match[1] ?? "").split(",")) {
      const name = specifier.trim();
      if (name && !name.startsWith("type ")) names.add(name.split(/\s+as\s+/)[0] ?? name);
    }
  }
  return names;
}

const pipeline = await sources(pipelineSource);
const functions = pipelineFunctions(pipeline);
const called = [...importedFromPipeline(await sources(apiSource))].flatMap((name) => {
  const list = functions.get(name);
  return list?.some((parameter) => /: Database\b/.test(parameter)) ? [{ name, list }] : [];
});

function takesTheAccount(list: readonly string[]): boolean {
  return list.some((parameter) => {
    if (/^userId\b/.test(parameter)) return true;
    const type = /:\s*([A-Z]\w*)$/.exec(parameter)?.[1];
    return type !== undefined && requiresUser(pipeline, type);
  });
}

describe("every pipeline function the API calls with the database takes its account", () => {
  it("finds the calls it is checking", () => {
    // A parser that stopped matching would pass every case below.
    expect(called.length).toBeGreaterThan(50);
    expect(called.filter(({ list }) => takesTheAccount(list)).length).toBeGreaterThan(40);
  });

  it("names the account, or is listed as instance-wide with a reason", () => {
    const unscoped = called
      .filter(({ name, list }) => !takesTheAccount(list) && !(name in instanceWide))
      .map(({ name, list }) => `${name}(${list.join(", ")})`);

    expect(unscoped).toEqual([]);
  });

  it("lists nothing as instance-wide that the API no longer calls unscoped", () => {
    const current = new Set(
      called.filter(({ list }) => !takesTheAccount(list)).map(({ name }) => name),
    );

    expect(Object.keys(instanceWide).filter((name) => !current.has(name))).toEqual([]);
  });
});
