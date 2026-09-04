#!/usr/bin/env node
/**
 * Capture the Bright Data payloads the Reddit connector parses.
 *
 * docs/testing.md: a fixture for someone else's API is captured, never
 * written. A payload we wrote is evidence about our parser and no evidence at
 * all about the wire format. So this script exists before the parser does, and
 * it stays committed and re-runnable afterwards, because the next person to
 * touch the parser needs to be able to ask the provider again.
 *
 * Run it with your own key. It spends records from your Bright Data
 * allowance — a few dozen, against a free tier of 5,000 a month:
 *
 *     node packages/core/src/sources/reddit/fixtures/capture.mjs
 *     node packages/core/src/sources/reddit/fixtures/capture.mjs --only=comments
 *
 * What it writes, into this folder:
 *
 *   <name>.json     one whole response body, with author identity scrubbed
 *   manifest.json   which request produced each file, and when
 *
 * The payloads are stored whole. Trimming one to the fields we happen to read
 * today is how a parser stops being tested against the fields it ignores.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../", import.meta.url));

const api = "https://api.brightdata.com/datasets/v3";

/**
 * Bright Data addresses a scraper by dataset id, and posts and comments are
 * two different datasets. That is the provider's whole reason for charging
 * twice when a monitor wants comments.
 */
const datasets = {
  posts: "gd_lvz8ah06191smkebj4",
  comments: "gd_lvzdpsdlw09j6t702",
};

/**
 * Small on purpose. Every record is billed, and a capture run that pages
 * through a subreddit teaches the parser nothing the first ten records did
 * not.
 */
const recordsPerInput = 5;

/**
 * Keyword discovery requires a `date`, and it is a named range, not a date.
 * Bright Data's own documentation shows a calendar date; the API rejects one
 * with `["date", "This value is not allowed"]`. These four were accepted:
 *
 *   "All time"  "Past month"  "Past week"  "Today"
 *
 * That is the whole reason this file exists before the parser does. The fact
 * is captured here rather than trusted from a document that is wrong.
 */
const dateRanges = ["All time", "Past month", "Past week", "Today"];

/** How long to poll a snapshot before giving up, and how often. */
const pollTimeoutMs = 10 * 60_000;
const pollIntervalMs = 10_000;

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

const apiKey = process.env.BRIGHTDATA_API_KEY || readEnvFile(`${root}.env`).BRIGHTDATA_API_KEY;

if (!apiKey) {
  console.error(
    [
      "No Bright Data key. Set BRIGHTDATA_API_KEY in .env, or in the environment.",
      "",
      "Reddit is reached through Bright Data because Reddit closed self-serve app",
      "registration in November 2025. A Bright Data account is self-serve and its",
      "free tier needs no card: 5,000 records a month. Get a key at",
      "https://brightdata.com, under Settings, API keys.",
    ].join("\n"),
  );
  process.exit(1);
}

// ------------------------------------------------------------- scrubbing

/**
 * Fields that name a person.
 *
 * They are replaced, not deleted: the parser has to keep seeing a value of the
 * right kind where the provider puts one, and a fixture missing a key is a
 * fixture that agrees with a parser which forgot to read it. The same real
 * value maps to the same pseudonym inside one run, so a payload that refers to
 * one author twice still does after scrubbing.
 *
 * The list is longer than it first looks. A Reddit avatar URL carries the
 * account id, and a bio is text the person wrote about themselves. Both were
 * missed on the first capture and found by listing every key in the payloads
 * rather than by reading the ones we parse.
 */
const identityFields = new Set([
  "user_posted",
  "user_posted_id",
  "user_id",
  "user_commenting",
  "user_replying",
  "author",
  "author_name",
  "author_id",
  "comment_author",
  "comment_author_id",
]);

/** Identity that arrives as a URL. Scrubbed to a URL, so the shape survives. */
const identityUrlFields = new Set([
  "user_url",
  "user_avatar",
  "author_url",
  "author_icon",
  "comment_author_url",
]);

/** Free text a person wrote about themselves. Not parsed, and not ours to keep. */
const personalTextFields = new Set(["bio_description"]);

const scrubbedBio = "Scrubbed by capture.mjs. See docs/testing.md.";

function createScrubber() {
  const pseudonyms = new Map();
  let count = 0;

  function pseudonym(value) {
    if (!pseudonyms.has(value)) {
      count += 1;
      pseudonyms.set(value, `redditor-${count}`);
    }
    return pseudonyms.get(value);
  }

  function scrub(value) {
    if (Array.isArray(value)) return value.map(scrub);
    if (value === null || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (typeof child === "string" && child !== "") {
          if (identityFields.has(key)) return [key, pseudonym(child)];
          if (identityUrlFields.has(key)) {
            return [key, `https://scrubbed.invalid/${pseudonym(child)}`];
          }
          if (personalTextFields.has(key)) return [key, scrubbedBio];
        }
        return [key, scrub(child)];
      }),
    );
  }

  return { scrub, replaced: () => pseudonyms.size };
}

// ------------------------------------------------------------------ http

/**
 * One request. Returns the status and the parsed body, and never throws on a
 * failure status: a rejection is a payload we want captured too. The
 * connector has to tell a user whose key is wrong from a user whose query
 * found nothing, and it can only do that against the real refusal.
 */
async function request(url, { method = "GET", body, key = apiKey } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();

  // Not every answer is JSON. An invalid key replies with the bare string
  // "Invalid credentials". Keep it as the string it was on the wire: wrapping
  // it in an object of our own invention would make the fixture a record of
  // this script rather than of the provider.
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  return { status: response.status, body: parsed };
}

function triggerUrl({ dataset, discoverBy }) {
  const params = new URLSearchParams({
    dataset_id: dataset,
    format: "json",
    include_errors: "true",
    limit_per_input: String(recordsPerInput),
  });

  if (discoverBy) {
    params.set("type", "discover_new");
    params.set("discover_by", discoverBy);
  }

  return `${api}/trigger?${params}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------- capturing

const written = [];
const failures = [];

function save(name, payload, request_) {
  const scrubber = createScrubber();
  const scrubbed = scrubber.scrub(payload);

  writeFileSync(`${here}${name}.json`, `${JSON.stringify(scrubbed, null, 2)}\n`);

  written.push({
    file: `${name}.json`,
    request: request_,
    capturedAt: new Date().toISOString(),
    identitiesReplaced: scrubber.replaced(),
  });

  const size = Array.isArray(scrubbed) ? `${scrubbed.length} records` : "1 object";
  console.log(`  wrote ${name}.json (${size}, ${scrubber.replaced()} identities scrubbed)`);
}

/**
 * Trigger a collection, poll it to completion, and capture every distinct
 * shape on the way: the trigger answer, each progress state, the refusal to
 * serve a snapshot that is not ready yet, and the finished records.
 *
 * Those middle shapes are the reason the connector can return
 * `next: { status: "wait" }` honestly. Without them we would be guessing at
 * what "still collecting" looks like, which is the guess this whole file
 * exists to avoid.
 */
async function captureCollection({ name, dataset, discoverBy, input }) {
  console.log(`\n${name}`);

  const url = triggerUrl({ dataset, discoverBy });
  const described = { method: "POST", url, body: input };

  const trigger = await request(url, { method: "POST", body: input });
  save(`${name}-trigger`, trigger.body, described);

  const snapshotId = trigger.body?.snapshot_id;
  if (trigger.status !== 200 || !snapshotId) {
    failures.push(`${name}: trigger answered ${trigger.status} with no snapshot id`);
    return undefined;
  }

  const progressUrl = `${api}/progress/${snapshotId}`;
  const downloadUrl = `${api}/snapshot/${snapshotId}?format=json`;

  const seenStatuses = new Set();
  let capturedEarlyDownload = false;
  const deadline = Date.now() + pollTimeoutMs;

  while (Date.now() < deadline) {
    const progress = await request(progressUrl);
    const status = progress.body?.status ?? `http-${progress.status}`;

    if (!seenStatuses.has(status)) {
      seenStatuses.add(status);
      save(`${name}-progress-${status}`, progress.body, { method: "GET", url: progressUrl });
    }

    // Ask for the data before it is ready, once. The connector needs to know
    // what an unfinished snapshot answers, because that is the branch that
    // decides between waiting and parsing.
    if (!capturedEarlyDownload && status !== "ready") {
      capturedEarlyDownload = true;
      const early = await request(downloadUrl);
      save(`${name}-snapshot-not-ready`, early.body, {
        method: "GET",
        url: downloadUrl,
        note: `asked while the snapshot was "${status}"`,
      });
    }

    if (status === "ready") {
      const download = await request(downloadUrl);
      save(`${name}-records`, download.body, { method: "GET", url: downloadUrl });
      return download.body;
    }

    if (status === "failed" || status === "canceled") {
      failures.push(`${name}: collection ${status}`);
      return undefined;
    }

    await sleep(pollIntervalMs);
  }

  failures.push(`${name}: still collecting after ${pollTimeoutMs / 60_000} minutes`);
  return undefined;
}

/**
 * The two answers a credential check can get.
 *
 * Both send an empty input list. That is the whole trick: an empty list cannot
 * start a collection, so the probe is free however valid the key is, and the
 * connector can check a key without ever risking a charge. A bad key answers
 * 401 before the input is looked at; a good one gets as far as complaining
 * that there is nothing to collect.
 *
 * Without these two payloads the check would be a guess about which failure
 * means which, and it would tell a user with a working key to go and replace
 * it.
 */
async function captureCredentialAnswers() {
  const url = triggerUrl({ dataset: datasets.posts, discoverBy: "keyword" });

  console.log("\ncredentials-rejected");
  const rejected = await request(url, { method: "POST", body: [], key: "this-key-is-not-real" });
  save(
    "credentials-rejected",
    { httpStatus: rejected.status, body: rejected.body },
    { method: "POST", url, body: [], note: "sent with a deliberately invalid bearer token" },
  );

  console.log("\ncredentials-accepted");
  const accepted = await request(url, { method: "POST", body: [] });
  save(
    "credentials-accepted",
    { httpStatus: accepted.status, body: accepted.body },
    {
      method: "POST",
      url,
      body: [],
      note: "sent with a working key; an empty input list collects nothing, so this costs nothing",
    },
  );
}

/**
 * A query the provider refuses. This costs nothing, and it is a different
 * failure from a bad key: the connector must not tell a user to check their
 * key when the query was the problem. The refusal names the offending field,
 * so the connector can repeat that sentence instead of inventing one.
 */
async function captureRejectedInput() {
  console.log("\ninput-rejected");

  const url = triggerUrl({ dataset: datasets.posts, discoverBy: "keyword" });
  const answer = await request(url, {
    method: "POST",
    // A calendar date. Bright Data's documentation shows one; the API only
    // accepts the named ranges in `dateRanges`.
    body: [{ keyword: "playwright tests", date: "2026-08-01", num_of_posts: 1 }],
  });

  save(
    "input-rejected",
    { httpStatus: answer.status, body: answer.body },
    {
      method: "POST",
      url,
      note: `sent date "2026-08-01"; the accepted values are ${dateRanges.map((r) => `"${r}"`).join(", ")}`,
    },
  );
}

// ---------------------------------------------------------------- the run

const only = process.argv
  .filter((argument) => argument.startsWith("--only="))
  .map((argument) => argument.slice("--only=".length));

const wanted = (name) => only.length === 0 || only.some((part) => name.includes(part));

console.log("Capturing Bright Data payloads. This spends records from your allowance.");

if (wanted("credentials")) {
  await captureCredentialAnswers();
}

if (wanted("input-rejected")) {
  await captureRejectedInput();
}

let discoveredPosts;

if (wanted("keyword")) {
  discoveredPosts = await captureCollection({
    name: "posts-discover-by-keyword",
    dataset: datasets.posts,
    discoverBy: "keyword",
    // A query with the shape a monitor generates: someone describing a problem
    // rather than naming a product.
    input: [
      {
        keyword: "playwright tests keep breaking",
        date: "Past month",
        num_of_posts: recordsPerInput,
      },
    ],
  });
}

if (wanted("subreddit")) {
  await captureCollection({
    name: "posts-discover-by-subreddit",
    dataset: datasets.posts,
    discoverBy: "subreddit_url",
    input: [{ url: "https://www.reddit.com/r/QualityAssurance/", sort_by: "New" }],
  });
}

if (wanted("comments")) {
  // Comments are collected by post URL only. Using a post this run discovered
  // keeps the two fixtures consistent, and it is also the exact sequence a
  // monitor with comments switched on pays for: discover, then fetch again.
  const postUrl = Array.isArray(discoveredPosts)
    ? discoveredPosts.find((r) => r?.url)?.url
    : undefined;

  if (!postUrl) {
    failures.push("comments: no post url to fetch comments for. Run without --only, or pass one.");
  } else {
    await captureCollection({
      name: "comments-by-post-url",
      dataset: datasets.comments,
      input: [{ url: postUrl, days_back: 30 }],
    });
  }
}

// ------------------------------------------------------------- the record

/**
 * A partial run must not erase the manifest entries for fixtures it did not
 * re-capture. Otherwise `--only` quietly turns the record of where the other
 * payloads came from into a blank, which is the one thing the manifest exists
 * to prevent.
 */
let kept = [];
if (only.length > 0) {
  try {
    const previous = JSON.parse(readFileSync(`${here}manifest.json`, "utf8"));
    const rewritten = new Set(written.map((entry) => entry.file));
    kept = (previous.fixtures ?? []).filter((entry) => !rewritten.has(entry.file));
  } catch {
    // No previous manifest. A full run is the fix, and the count below says so.
  }
}

const fixtures = [...kept, ...written].sort((a, b) => a.file.localeCompare(b.file));

writeFileSync(
  `${here}manifest.json`,
  `${JSON.stringify(
    {
      capturedBy: "packages/core/src/sources/reddit/fixtures/capture.mjs",
      provider: "Bright Data, Reddit Scraper API, datasets v3",
      note: "Author identity is replaced with stable pseudonyms. Everything else is whole.",
      fixtures,
    },
    null,
    2,
  )}\n`,
);

console.log(`\nWrote ${written.length} fixtures. manifest.json lists ${fixtures.length}.`);

if (failures.length > 0) {
  console.error("\nSome captures did not finish:");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error("\nThe payloads that did arrive are still written. Fix and re-run.");
  process.exit(1);
}
