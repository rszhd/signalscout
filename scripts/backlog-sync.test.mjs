/**
 * `backlog/sync.sh` against a fake `gh`, so no run reaches GitHub.
 *
 * What is asserted is the part that decides whether a run opens an issue: it
 * adopts an open issue already titled with the ticket's id, refuses to choose
 * between two, and names a second one beside the issue the file records. A
 * wrong answer here is a duplicate issue that nobody notices. BUG-323.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const script = new URL("../backlog/sync.sh", import.meta.url).pathname;

/**
 * The calls `sync.sh` makes, answered from a JSON file of issues. Each call is
 * appended to a log so a test can say what was and was not asked.
 */
const fakeGh = `#!/usr/bin/env node
const { readFileSync, writeFileSync, appendFileSync } = require("node:fs");
const statePath = process.env.FAKE_GH_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + "\\n");
const flag = (name) => args[args.indexOf(name) + 1];
const [noun, verb, number] = args;
const issue = state.issues.find((i) => String(i.number) === number);
const save = () => writeFileSync(statePath, JSON.stringify(state));

if (noun !== "issue") process.exit(2);
if (verb === "list") {
  for (const i of state.issues) {
    if (i.state === "OPEN" && i.labels.includes("ticket")) console.log(i.number + "\\t" + i.title);
  }
} else if (verb === "view") {
  if (!issue) process.exit(1);
  if (flag("--json") === "state") console.log(issue.state);
  else console.log([issue.title, issue.state, [...issue.labels].sort().join(",")].join("\\t"));
} else if (verb === "create") {
  const created = {
    number: Math.max(0, ...state.issues.map((i) => i.number)) + 1,
    title: flag("--title"),
    state: "OPEN",
    labels: [...new Set(args.filter((_, n) => args[n - 1] === "--label"))],
  };
  state.issues.push(created);
  save();
  console.log("https://github.com/rszhd/signalscout/issues/" + created.number);
} else if (verb === "edit" || verb === "reopen" || verb === "close") {
  if (!issue) process.exit(1);
  if (verb === "edit") issue.title = flag("--title");
  if (verb === "reopen") issue.state = "OPEN";
  if (verb === "close") issue.state = "CLOSED";
  save();
} else {
  process.exit(2);
}
`;

function ticket({ id, title, issue = "" }) {
  return [
    "---",
    `id: ${id}`,
    ...(issue ? [`issue: ${issue}`] : []),
    `title: ${title}`,
    "type: bug",
    "priority: p2",
    "created: 2026-09-23T05:44+08:00",
    "resolution:",
    "---",
    "",
    "## Context",
    "",
    "Why it exists.",
    "",
  ].join("\n");
}

const roots = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A backlog in a temporary folder, with its own copy of the script. */
function backlog({ tickets, issues }) {
  const root = mkdtempSync(join(tmpdir(), "backlog-sync-"));
  roots.push(root);
  const dir = join(root, "backlog");
  const bin = join(root, "bin");
  mkdirSync(join(dir, "todo"), { recursive: true });
  mkdirSync(bin);
  copyFileSync(script, join(dir, "sync.sh"));
  writeFileSync(join(bin, "gh"), fakeGh);
  chmodSync(join(bin, "gh"), 0o755);

  const files = tickets.map((t) => {
    const file = join(dir, "todo", `${t.id}-a-ticket.md`);
    writeFileSync(file, ticket(t));
    return file;
  });
  const statePath = join(root, "issues.json");
  const logPath = join(root, "gh.log");
  writeFileSync(statePath, JSON.stringify({ issues }));
  writeFileSync(logPath, "");

  return {
    files,
    run(mode) {
      const result = spawnSync("bash", [join(dir, "sync.sh"), ...(mode ? [mode] : [])], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FAKE_GH_STATE: statePath,
          FAKE_GH_LOG: logPath,
        },
      });
      return { status: result.status, output: result.stdout + result.stderr };
    },
    issues: () => JSON.parse(readFileSync(statePath, "utf8")).issues,
    calls: () =>
      readFileSync(logPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

const open = (number, title) => ({ number, title, state: "OPEN", labels: ["ticket"] });
const created = (calls) => calls.filter(([, verb]) => verb === "create");

describe("a ticket with no issue: field", () => {
  it("adopts the one open issue titled with its id, and opens none", () => {
    const b = backlog({
      tickets: [{ id: "BUG-311", title: "A bug" }],
      issues: [open(63, "BUG-311: A bug")],
    });

    const { status, output } = b.run();

    expect(status).toBe(0);
    expect(output).toContain("adopted #63 for BUG-311");
    expect(readFileSync(b.files[0], "utf8")).toMatch(/^issue: 63$/m);
    expect(created(b.calls())).toEqual([]);
  });

  it("refuses to choose between two, and writes and opens nothing", () => {
    const b = backlog({
      tickets: [{ id: "BUG-311", title: "A bug" }],
      issues: [open(63, "BUG-311: A bug"), open(64, "BUG-311: A bug")],
    });

    const { status, output } = b.run();

    expect(status).toBe(1);
    expect(output).toContain("#63, #64");
    expect(readFileSync(b.files[0], "utf8")).not.toMatch(/^issue:/m);
    expect(created(b.calls())).toEqual([]);
  });

  it("opens one when no issue carries its id", () => {
    const b = backlog({ tickets: [{ id: "US-313", title: "A patch" }], issues: [] });

    const { status } = b.run();

    expect(status).toBe(0);
    expect(b.issues()).toEqual([
      { number: 1, title: "US-313: A patch", state: "OPEN", labels: ["ticket"] },
    ]);
    expect(readFileSync(b.files[0], "utf8")).toMatch(/^issue: 1$/m);
  });

  it("does not take an issue whose id only starts the same", () => {
    const b = backlog({
      tickets: [{ id: "US-31", title: "Short" }],
      issues: [open(40, "US-313: A patch")],
    });

    const { output } = b.run();

    expect(output).toContain("opened #41 for US-31");
    expect(output).not.toContain("adopted");
  });

  it("is reported by --check with the issue a sync would adopt, and changes nothing", () => {
    const b = backlog({
      tickets: [{ id: "BUG-311", title: "A bug" }],
      issues: [open(63, "BUG-311: A bug")],
    });

    const { status, output } = b.run("--check");

    expect(status).toBe(1);
    expect(output).toContain("#63 carries its id");
    expect(readFileSync(b.files[0], "utf8")).not.toMatch(/^issue:/m);
  });
});

describe("a ticket that already names its issue", () => {
  it("fails --check when a second open issue carries its id", () => {
    const b = backlog({
      tickets: [{ id: "BUG-311", title: "A bug", issue: "64" }],
      issues: [open(63, "BUG-311: A bug"), open(64, "BUG-311: A bug")],
    });

    const { status, output } = b.run("--check");

    expect(status).toBe(1);
    expect(output).toContain("duplicate: #63 also carries BUG-311");
  });

  it("passes --check when its issue is the only one", () => {
    const b = backlog({
      tickets: [{ id: "BUG-311", title: "A bug", issue: "64" }],
      issues: [{ ...open(63, "BUG-311: A bug"), state: "CLOSED" }, open(64, "BUG-311: A bug")],
    });

    const { status, output } = b.run("--check");

    expect(status).toBe(0);
    expect(output).toContain("the mirror matches the ticket files");
  });
});
