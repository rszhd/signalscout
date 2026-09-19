#!/usr/bin/env node
/**
 * What a session reads before it writes anything.
 *
 * Cutting a document is easy to feel good about and hard to check. Word
 * counts are a proxy: they say a file is smaller, not that a session paid
 * less for it. This reads Claude Code's own transcripts and reports, for
 * every task in them, the context the model was carrying at the moment it
 * first changed a file.
 *
 *     node scripts/context-cost.mjs                 # this project, last 5 sessions
 *     node scripts/context-cost.mjs --sessions=20
 *     node scripts/context-cost.mjs --since=2026-09-18
 *     node scripts/context-cost.mjs --files         # also what was read, by path
 *     node scripts/context-cost.mjs --json
 *
 * **A task is one typed prompt and everything up to the first edit.** A
 * prompt the model answers without editing anything is a question, not a
 * task, and it is left out — it has no "before" to measure. A prompt that
 * edits on the first tool call reads as near zero, which is correct: it
 * asked for something the session already knew.
 *
 * **Two numbers, and the second is the one to watch.** *Carried* is every
 * prompt token at that moment, cached or not — what the model is holding.
 * *Added* is how much of it this task put there, measured from its own first
 * turn. Carried grows with the session and says little about a document;
 * added is what a shorter document is supposed to change. Cost in dollars is
 * a different question and this does not answer it.
 *
 * It reads `~/.claude/projects/<cwd-slug>/*.jsonl`, which is a private log of
 * this machine's sessions. It prints counts and paths, never message text,
 * and it writes nothing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const found = args.find((one) => one.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.slice(name.length + 3);
};
const has = (name) => args.includes(`--${name}`);

/** Claude Code names a project folder after its working directory. */
const slugOf = (path) => path.replace(/[/.]/g, "-");

/**
 * The folder for this directory, or for the nearest parent that has one.
 *
 * A session started in the repository root and a session started in the
 * folder above it — the two checkouts sit side by side — write to different
 * folders, and the one you want is usually where the session ran rather than
 * where this script does.
 */
function transcriptRoot() {
  const base = join(homedir(), ".claude", "projects");
  let path = process.cwd();

  for (;;) {
    const candidate = join(base, slugOf(path));
    try {
      if (readdirSync(candidate).some((name) => name.endsWith(".jsonl"))) return candidate;
    } catch {
      // No folder for this directory; try the one above it.
    }

    const parent = dirname(path);
    if (parent === path) return join(base, slugOf(process.cwd()));
    path = parent;
  }
}

const root = transcriptRoot();
const sessionLimit = Number(flag("sessions", "5"));
const since = flag("since", null);

/** The tools that change a file. A Bash `sed -i` is not counted; see below. */
const writingTools = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

/** Tools whose result is a file's contents, for the `--files` breakdown. */
const readingTools = new Set(["Read", "Grep", "Glob"]);

function sessions() {
  let names;
  try {
    names = readdirSync(root).filter((name) => name.endsWith(".jsonl"));
  } catch {
    console.error(`No transcripts for this directory.\nLooked in ${root}`);
    process.exit(1);
  }

  return names
    .map((name) => ({ name, path: join(root, name), at: statSync(join(root, name)).mtime }))
    .sort((a, b) => b.at - a.at)
    .slice(0, sessionLimit);
}

function* lines(path) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      yield JSON.parse(line);
    } catch {
      // A transcript being written while this runs ends in half a line.
    }
  }
}

/** A typed prompt, as opposed to a tool result the harness sent back. */
function typedPrompt(entry) {
  if (entry.type !== "user") return null;
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join(" ");

  return text === "" ? null : text;
}

const promptTokens = (usage) =>
  (usage?.input_tokens ?? 0) +
  (usage?.cache_read_input_tokens ?? 0) +
  (usage?.cache_creation_input_tokens ?? 0);

function toolUses(entry) {
  const content = entry.message?.content;

  return Array.isArray(content) ? content.filter((block) => block?.type === "tool_use") : [];
}

/** One task: a typed prompt, and everything up to the first edit after it. */
function tasks(path) {
  const found = [];
  let open = null;

  for (const entry of lines(path)) {
    const prompt = typedPrompt(entry);

    if (prompt !== null) {
      // A prompt that arrives before the last one edited anything replaces
      // it: the person moved on, so there is nothing to measure.
      open = {
        at: entry.timestamp,
        prompt: prompt.replace(/\s+/g, " ").slice(0, 70),
        turns: 0,
        reads: [],
        tokens: null,
        opening: null,
      };
      continue;
    }

    if (entry.type !== "assistant" || open === null) continue;

    open.turns += 1;
    // The first turn of this task, before it has read anything of its own.
    if (open.opening === null) open.opening = promptTokens(entry.message?.usage);

    for (const use of toolUses(entry)) {
      if (readingTools.has(use.name) && use.input?.file_path) open.reads.push(use.input.file_path);

      if (!writingTools.has(use.name)) continue;

      open.tokens = promptTokens(entry.message?.usage);
      open.added = open.tokens - (open.opening ?? open.tokens);
      open.wrote = use.input?.file_path ?? "";
      found.push(open);
      open = null;
      break;
    }
  }

  return found;
}

const all = [];
for (const session of sessions()) {
  for (const task of tasks(session.path)) {
    if (since !== null && task.at < since) continue;
    all.push({ ...task, session: session.name.slice(0, 8) });
  }
}

if (all.length === 0) {
  console.error("No task in these sessions reached an edit. Try --sessions=20.");
  process.exit(1);
}

if (has("json")) {
  console.log(JSON.stringify(all, null, 2));
  process.exit(0);
}

const summary = (key) => {
  const values = all.map((task) => task[key]).sort((a, b) => a - b);
  const total = values.reduce((sum, one) => sum + one, 0);

  return {
    median: values[Math.floor(values.length / 2)],
    mean: Math.round(total / values.length),
    lowest: values[0],
    highest: values.at(-1),
  };
};

const carried = summary("tokens");
const added = summary("added");

console.log(`\n${all.length} tasks, from ${sessionLimit} sessions in ${root}\n`);
console.log("At the first edit:            carried        added by this task");
for (const name of ["median", "mean", "lowest", "highest"]) {
  console.log(
    `  ${name.padEnd(24)}${String(carried[name].toLocaleString()).padStart(9)}` +
      `${String(added[name].toLocaleString()).padStart(20)}`,
  );
}

const sorted = [...all].sort((a, b) => b.added - a.added);
console.log("\nThe ten that added most:\n");
console.log("    added  carried  turns  when              prompt");
for (const task of sorted.slice(0, 10)) {
  const when = task.at?.slice(0, 16).replace("T", " ") ?? "";
  console.log(
    `  ${String(task.added).padStart(7)}  ${String(task.tokens).padStart(7)}  ${String(task.turns).padStart(5)}  ${when}  ${task.prompt}`,
  );
}

if (has("files")) {
  const counts = new Map();
  for (const task of all) {
    for (const path of new Set(task.reads)) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }

  console.log(
    "\nRead before an edit, by how many tasks." +
      "\nOnly the Read, Grep and Glob tools; a `cat` through Bash is invisible.\n",
  );
  for (const [path, count] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${String(count).padStart(3)}  ${path.replace(`${process.cwd()}/`, "")}`);
  }
}

console.log(
  "\nThis counts a prompt's tokens, cached or not, and only tasks that reached\n" +
    "an Edit or a Write. A `sed -i` through Bash is invisible to it, so a\n" +
    "session that edits through the shell reports fewer tasks than it ran.\n",
);
