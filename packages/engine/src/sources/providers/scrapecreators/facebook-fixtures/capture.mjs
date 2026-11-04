#!/usr/bin/env node
/**
 * Capture the ScrapeCreators payloads a Facebook group connector parses.
 *
 * docs/testing.md: a fixture for someone else's API is captured, never
 * written. US-516 asks five questions, and this script answers each one:
 *
 *   1. What is one page of a public group's posts, every field.
 *   2. What is the cursor, and does page two repeat page one?
 *   3. What does a page with a top post look like? CHRONOLOGICAL put an older
 *      post above newer ones in the probe (US-516's Log).
 *   4. What does a group that does not exist, or is not public, return, and
 *      is it billed?
 *   5. What does a refused key say?
 *
 * The vocabulary is in https://docs.scrapecreators.com/v1/facebook/group/posts
 * and costs nothing to read. This provider bills an invalid parameter value,
 * so nothing here tries one.
 *
 * Run it with your own key. It spends about five credits:
 *
 *     node packages/engine/src/sources/providers/scrapecreators/facebook-fixtures/capture.mjs
 *
 * What it writes, into this folder:
 *
 *   <name>.json      one answer, scrubbed, stored whole
 *   manifest.json    which request produced each file, and when
 *   ledger.json      what each call did to the account's credit balance
 *
 * Scrubbing names the containers: `author` on a post and on a comment, and
 * the profile part of `permalink`. Post and comment text is kept, because it
 * is what the product classifies. Every fbcdn media address is a signed URL
 * that expires, so each one is replaced with one placeholder address.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));

const endpoint = "https://api.scrapecreators.com/v1/facebook/group/posts";
const balanceEndpoint = "https://api.scrapecreators.com/v1/credit-balance";

/** Public owner groups the probe read on 2026-11-04 (US-516's Log). */
const groups = {
  /** Newest first after the first post; four posts a page. */
  sage: "https://www.facebook.com/groups/856491544939621/",
  /** An admin post, then a post two days older, then newer ones. */
  ninja: "https://www.facebook.com/groups/ninjaespressoenthusiasts/",
  /** A name no group has. */
  missing: "https://www.facebook.com/groups/intentwatch-no-such-group-zqxjkv/",
  /** A group a 2017 article called private. If it is public, the file says so. */
  maybePrivate: "https://www.facebook.com/groups/baristahustle/",
};

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

const apiKey =
  process.env.SCRAPECREATORS_API_KEY || readEnvFile(`${root}.env`).SCRAPECREATORS_API_KEY;

if (!apiKey) {
  console.error(
    "No ScrapeCreators key. Set SCRAPECREATORS_API_KEY in .env, or in the environment.",
  );
  process.exit(1);
}

// ------------------------------------------------------------- scrubbing

const mediaPlaceholder = "https://scrubbed.invalid/media-url-expired.bin";
const scrubbedText = "Scrubbed by capture.mjs. See docs/testing.md.";

function createScrubber() {
  const pseudonyms = new Map();

  function pseudonym(value) {
    if (!pseudonyms.has(value)) pseudonyms.set(value, `member-${pseudonyms.size + 1}`);
    return pseudonyms.get(value);
  }

  /** An author is a person, whatever fields it carries: every string goes. */
  function scrubAuthor(author) {
    if (author === null || typeof author !== "object") return author;
    return Object.fromEntries(
      Object.entries(author).map(([key, value]) => {
        if (typeof value !== "string" || value === "" || key === "__typename") return [key, value];
        if (key === "gender") return [key, scrubbedText];
        if (key === "url") return [key, `https://www.facebook.com/${pseudonym(value)}`];
        return [key, pseudonym(value)];
      }),
    );
  }

  /**
   * A permalink can name the author's profile:
   * `https://www.facebook.com/<profile>/videos/<id>/?idorvanity=<group>`.
   * The profile part is replaced; the ids stay readable.
   */
  function scrubPermalink(value) {
    return value.replace(
      /^(https:\/\/www\.facebook\.com\/)(?!groups\/)([^/?#]+)/,
      (_match, host, profile) => `${host}${pseudonym(profile)}`,
    );
  }

  /**
   * A group's welcome post names every new member, one per line:
   * "Name Surname,\nName Surname,\n…". The first capture kept about 250 real
   * names this way. Three or more lines in a row that each end with a comma
   * are one such list. The list and the short line after it, the last name
   * with no comma, are replaced; the rest of the text stays.
   */
  function scrubNameLists(value) {
    return value.replace(
      /(?:^[^\n,]{1,60},[ \t]*\n){3,}(?:[^\n,]{1,60}(?:\n|$))?/gm,
      `${scrubbedText}\n`,
    );
  }

  function scrubString(key, value) {
    if (/^https:\/\/[^/]*fbcdn\.net\//.test(value)) return mediaPlaceholder;
    if (key === "permalink") return scrubPermalink(value);
    if (key === "text") return scrubNameLists(value);
    return value;
  }

  function scrub(value, key = "") {
    if (typeof value === "string") return scrubString(key, value);
    if (Array.isArray(value)) return value.map((child) => scrub(child, key));
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) =>
        childKey === "author" ? [childKey, scrubAuthor(child)] : [childKey, scrub(child, childKey)],
      ),
    );
  }

  return { scrub, replaced: () => pseudonyms.size };
}

// ------------------------------------------------------------------ http

async function request(url, { key = apiKey } = {}) {
  const startedAt = Date.now();
  const response = await fetch(url, { headers: { "x-api-key": key } });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, elapsedMs: Date.now() - startedAt };
}

async function balance() {
  const answer = await request(balanceEndpoint);
  return typeof answer.body?.creditCount === "number" ? answer.body.creditCount : undefined;
}

const urlFor = (params) => `${endpoint}?${new URLSearchParams(params)}`;

// ------------------------------------------------------------- capturing

const manifest = [];
const ledger = [];

/** One call: balance before and after, the answer scrubbed and saved whole. */
async function capture(name, params, { key } = {}) {
  const before = await balance();
  const url = urlFor(params);
  const answer = await request(url, { key });
  const after = await balance();

  const scrubber = createScrubber();
  const body = scrubber.scrub(answer.body);
  writeFileSync(
    `${here}${name}.json`,
    `${JSON.stringify({ status: answer.status, body }, null, 2)}\n`,
  );

  const posts = Array.isArray(answer.body?.posts) ? answer.body.posts : [];
  manifest.push({
    file: `${name}.json`,
    capturedAt: new Date().toISOString(),
    request: {
      endpoint,
      params: { ...params, ...(params.cursor ? { cursor: "<page 1 cursor>" } : {}) },
    },
    status: answer.status,
    posts: posts.length,
    pseudonyms: scrubber.replaced(),
    elapsedMs: answer.elapsedMs,
  });
  ledger.push({
    file: `${name}.json`,
    creditsBefore: before,
    creditsAfter: after,
    spent: before !== undefined && after !== undefined ? before - after : undefined,
    creditsCharged: answer.body?.credits_charged,
  });
  console.log(name, "status", answer.status, "posts", posts.length, "spent", before - after);
  return answer;
}

const first = await capture("group-page-1", { url: groups.sage, sort_by: "CHRONOLOGICAL" });
if (typeof first.body?.cursor === "string") {
  await capture("group-page-2", {
    url: groups.sage,
    sort_by: "CHRONOLOGICAL",
    cursor: first.body.cursor,
  });
}
await capture("group-top-post", { url: groups.ninja, sort_by: "CHRONOLOGICAL" });
await capture("group-missing", { url: groups.missing, sort_by: "CHRONOLOGICAL" });
await capture("group-maybe-private", { url: groups.maybePrivate, sort_by: "CHRONOLOGICAL" });
await capture(
  "credentials-rejected",
  { url: groups.sage, sort_by: "CHRONOLOGICAL" },
  { key: "intentwatch-not-a-real-key" },
);

writeFileSync(`${here}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(`${here}ledger.json`, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(
  "total spent",
  ledger.reduce((sum, row) => sum + (row.spent ?? 0), 0),
);
