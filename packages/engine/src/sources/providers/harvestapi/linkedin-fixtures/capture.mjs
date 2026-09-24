#!/usr/bin/env node
/**
 * Ask HarvestAPI's own API what a LinkedIn search returns and what it costs.
 *
 * US-386. Apify runs HarvestAPI's actor for us and bills a post; the direct API
 * bills a request, which is one page of results. The ticket's Context holds the
 * price table. This script answers the eight questions the ticket lists, in
 * the ticket's order, and a connector is written from what it finds.
 *
 * The rules for a capture are in docs/sources.md, *Capturing one, in order*.
 *
 * Run it with your own key, read from `.env` or the environment, never from
 * the command line:
 *
 *     node packages/engine/src/sources/providers/harvestapi/linkedin-fixtures/capture.mjs
 *     node .../capture.mjs --only=search
 *     node .../capture.mjs --only=comments
 *     node .../capture.mjs --rescrub        # re-scrub the last raw answers, buying nothing
 *
 * **Cost.** Five paid requests: three searches, one empty search and one
 * comment page. At the Starter price of $0.004 a request that is $0.02. The
 * rejected key and the account read are expected to be free; the ledger
 * records the balance either side of every call, so that claim is measured.
 *
 * What it writes, into this folder:
 *
 *   <name>.json     the answer, with author identity scrubbed
 *   manifest.json   which request produced each file
 *   ledger.json     what each request moved the balance by
 *   findings.json   the answers to the ticket's questions, computed
 *
 * The unscrubbed answers go to the system temporary folder, never here, so
 * that a scrubber fixed after a run can be re-applied without buying the
 * answers twice.
 *
 * **Read the fixtures before committing them.** The scrubber is the Apify
 * capture's, because the upstream is the same; that makes it likely and not
 * certain to hold.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScrubber } from "../../linkedin-scrubber.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));
const rawDir = join(tmpdir(), "signalscout-harvestapi-linkedin-raw");

const api = "https://api.harvestapi.io";

/** The query every earlier LinkedIn capture used, so the providers compare. */
const keyword = "flaky tests";

/** A phrase that cannot occur, for question 3. */
const impossible = "kumquat velocipede telemetry brunch";

// ---------------------------------------------------------------- the key

/** Read .env without a dependency, the way scripts/dev.mjs does. */
function readEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }

  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^["']|["']$/g, "")];
      }),
  );
}

const rescrub = process.argv.includes("--rescrub");

const apiKey = process.env.HARVESTAPI_API_KEY || readEnvFile(`${root}.env`).HARVESTAPI_API_KEY;

if (!apiKey && !rescrub) {
  console.error(
    [
      "No HarvestAPI key. Set HARVESTAPI_API_KEY in .env, or in the environment.",
      "",
      "Create one at https://harvestapi.io/admin/api-keys. It needs no LinkedIn",
      "account of your own.",
    ].join("\n"),
  );
  process.exit(1);
}

// ------------------------------------------------------------------ http

async function call(path, params = {}, key = apiKey) {
  const query = new URLSearchParams(params).toString();
  const startedAt = Date.now();

  const response = await fetch(`${api}${path}${query ? `?${query}` : ""}`, {
    headers: { "X-API-Key": key, Accept: "application/json" },
  });

  const text = await response.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { status: response.status, body, elapsedMs: Date.now() - startedAt };
}

/**
 * Every number in the account answer whose name says credit or balance.
 *
 * The shape of `/users/my-api-user` is undocumented, so the fields are found by
 * name rather than assumed. Only numbers are kept: the rest of that answer is
 * the account holder, and nothing about them belongs in a fixture.
 */
function moneyFields(value, prefix = "", depth = 0, out = {}) {
  if (depth > 4 || value === null || typeof value !== "object") return out;

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "number" && /credit|balance|usd|remaining|spent|usage/i.test(key)) {
      out[path] = child;
    } else if (typeof child === "object") {
      moneyFields(child, path, depth + 1, out);
    }
  }

  return out;
}

async function account() {
  const answer = await call("/users/my-api-user");
  return { status: answer.status, money: moneyFields(answer.body) };
}

/** What moved between two account reads, field by field. */
function moved(before, after) {
  const out = {};
  for (const [key, value] of Object.entries(after.money)) {
    const was = before.money[key];
    if (typeof was === "number" && was !== value) out[key] = Number((value - was).toFixed(6));
  }
  return out;
}

// ------------------------------------------------------------- capturing

const written = [];
const ledger = [];
const failures = [];

function saveRaw(name, answer, request) {
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, `${name}.json`), JSON.stringify({ request, answer }));
}

function readRaw(name) {
  try {
    return JSON.parse(readFileSync(join(rawDir, `${name}.json`), "utf8"));
  } catch {
    return undefined;
  }
}

function save(name, request, answer) {
  const scrubber = createScrubber();
  const payload = scrubber.scrub(answer.body);

  writeFileSync(`${here}${name}.json`, `${JSON.stringify(payload, null, 2)}\n`);
  written.push({
    file: `${name}.json`,
    // Scrubbed too: the comments request names a post by its URL, and a post
    // URL starts with its author's name. The first run committed one here.
    request: createScrubber().scrub(request),
    httpStatus: answer.status,
    capturedAt: new Date().toISOString(),
    identitiesReplaced: scrubber.replaced(),
  });
}

/** One paid request, with the balance read either side of it. */
async function capture(name, path, params) {
  const request = { path, params };

  if (rescrub) {
    const raw = readRaw(name);
    if (!raw) {
      failures.push(`${name}: no raw answer in ${rawDir}`);
      return undefined;
    }
    save(name, raw.request, raw.answer);
    return raw.answer;
  }

  const before = await account();
  const answer = await call(path, params);
  const after = await account();

  saveRaw(name, answer, request);
  save(name, request, answer);

  ledger.push({
    run: name,
    request: createScrubber().scrub(request),
    httpStatus: answer.status,
    elapsedMs: answer.elapsedMs,
    accountFieldsMoved: moved(before, after),
  });

  if (answer.status !== 200) failures.push(`${name}: HTTP ${answer.status}`);
  return answer;
}

const only = process.argv
  .filter((argument) => argument.startsWith("--only="))
  .map((argument) => argument.slice("--only=".length));

const wanted = (name) => only.length === 0 || only.some((part) => name.includes(part));

// ---------------------------------------------------------------- the run

const answers = {};

if (!rescrub && wanted("credentials")) {
  // Question 5. A key that cannot exist, so nothing can be charged to anybody.
  const refused = await call("/linkedin/post-search", { search: keyword }, "not-a-real-key");
  saveRaw("credentials-rejected", refused, { path: "/linkedin/post-search" });
  save("credentials-rejected", { path: "/linkedin/post-search", key: "invalid" }, refused);
  ledger.push({
    run: "credentials-rejected",
    httpStatus: refused.status,
    note: "sent with a deliberately invalid key",
  });

  // The key check a connector makes, refused the same way.
  const probeRefused = await call("/users/my-api-user", {}, "not-a-real-key");
  save("probe-rejected", { path: "/users/my-api-user", key: "invalid" }, probeRefused);
  ledger.push({
    run: "probe-rejected",
    httpStatus: probeRefused.status,
    note: "sent with a deliberately invalid key",
  });

  // Question 6. Two reads of the account, nothing between them.
  const first = await account();
  const second = await account();
  answers.accountRead = {
    httpStatus: first.status,
    fieldsFound: Object.keys(first.money),
    movedBetweenTwoReads: moved(first, second),
  };
}

const searches = [
  ["search-by-date", { search: keyword, sortBy: "date" }],
  ["search-past-24h", { search: keyword, sortBy: "date", postedLimit: "24h" }],
  ["search-page-2", { search: keyword, sortBy: "date", page: "2" }],
  ["search-no-results", { search: impossible, sortBy: "date" }],
];

for (const [name, params] of searches) {
  if (!wanted(name)) continue;
  answers[name] = await capture(name, "/linkedin/post-search", params);
}

if (wanted("comments")) {
  // Question 7. The post with the most comments on the first page, so the
  // shape of a reply has the best chance of appearing.
  const page = answers["search-by-date"]?.body ?? readRaw("search-by-date")?.answer?.body;
  const posts = Array.isArray(page?.elements) ? page.elements : [];
  const target = [...posts].sort(
    (a, b) => (b?.engagement?.comments ?? 0) - (a?.engagement?.comments ?? 0),
  )[0];

  if (target?.linkedinUrl) {
    answers.comments = await capture("comments", "/linkedin/post-comments", {
      post: target.linkedinUrl,
      sortBy: "date",
    });
  } else {
    failures.push("comments: no post URL from search-by-date to ask about");
  }
}

// ------------------------------------------------------------ the answers

const bodyOf = (name) => answers[name]?.body ?? readRaw(name)?.answer?.body;

function describePage(name) {
  const body = bodyOf(name);
  if (!body || typeof body !== "object") return undefined;

  const elements = Array.isArray(body.elements) ? body.elements : [];
  const dates = elements
    .map((post) => post?.postedAt?.date)
    .filter((date) => typeof date === "string");

  const newestFirst = dates.every((date, index) => index === 0 || dates[index - 1] >= date);

  return {
    items: elements.length,
    pagination: body.pagination ?? null,
    status: body.status ?? null,
    error: body.error ?? null,
    newest: dates.length ? [...dates].sort().at(-1) : null,
    oldest: dates.length ? [...dates].sort()[0] : null,
    orderedNewestFirst: newestFirst,
    // Question 4: the id is a bare number and the URL ends in the same one.
    idsAreActivityIds: elements.every(
      (post) =>
        typeof post?.id === "string" &&
        /^\d{15,}$/.test(post.id) &&
        typeof post?.linkedinUrl === "string" &&
        post.linkedinUrl.includes(post.id),
    ),
    distinctIds: new Set(elements.map((post) => post?.id)).size,
    fields: [...new Set(elements.flatMap((post) => Object.keys(post ?? {})))].sort(),
  };
}

function readCommittedFindings() {
  try {
    return JSON.parse(readFileSync(`${here}findings.json`, "utf8"));
  } catch {
    return {};
  }
}

const findings = {
  note: "Computed by capture.mjs from the answers it wrote. US-386 reads these.",
  // A `--rescrub` or `--only=` run asks no account question; keep the last
  // answer rather than dropping it.
  accountRead: answers.accountRead ?? readCommittedFindings().accountRead,
  pages: Object.fromEntries(
    searches.map(([name]) => [name, describePage(name)]).filter(([, value]) => value),
  ),
};

const first = bodyOf("search-by-date")?.elements ?? [];
const second = bodyOf("search-page-2")?.elements ?? [];
if (first.length && second.length) {
  const ids = new Set(first.map((post) => post?.id));
  findings.pageTwoOverlapsPageOne = second.filter((post) => ids.has(post?.id)).length;
}

const comments = bodyOf("comments");
if (comments && typeof comments === "object") {
  const elements = Array.isArray(comments.elements) ? comments.elements : [];
  findings.comments = {
    items: elements.length,
    pagination: comments.pagination ?? null,
    fields: [...new Set(elements.flatMap((comment) => Object.keys(comment ?? {})))].sort(),
    nestedReplies: elements.reduce(
      (sum, comment) => sum + (Array.isArray(comment?.replies) ? comment.replies.length : 0),
      0,
    ),
  };
}

function mergedBy(key, existingPath, fresh) {
  let existing = [];
  try {
    existing = JSON.parse(readFileSync(existingPath, "utf8"))[key] ?? [];
  } catch {
    existing = [];
  }

  const name = (entry) => entry.file ?? entry.run;
  const redone = new Set(fresh.map(name));

  return [...existing.filter((entry) => !redone.has(name(entry))), ...fresh];
}

writeFileSync(`${here}findings.json`, `${JSON.stringify(findings, null, 2)}\n`);

writeFileSync(
  `${here}manifest.json`,
  `${JSON.stringify(
    {
      note:
        "Which request produced each file. Captured from the live API; see " +
        "docs/testing.md on why these are captured and never written.",
      provider: "harvestapi",
      platform: "linkedin",
      files: mergedBy("files", `${here}manifest.json`, written),
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  `${here}ledger.json`,
  `${JSON.stringify(
    {
      note:
        "What each request moved on the account, read from /users/my-api-user " +
        "before and after it. Empty means nothing the account reports moved.",
      runs: mergedBy("runs", `${here}ledger.json`, ledger).map((entry) =>
        entry.request ? { ...entry, request: createScrubber().scrub(entry.request) } : entry,
      ),
    },
    null,
    2,
  )}\n`,
);

console.log(JSON.stringify(findings, null, 2));
console.log(
  `\nwrote ${written.length} fixtures. The unscrubbed answers are in ${rawDir}; delete them when done.`,
);
console.log("Read the fixtures before committing them.");

if (failures.length > 0) {
  console.error("\nSome captures did not finish:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
