#!/usr/bin/env node
/**
 * Capture the ScrapeCreators payloads the Facebook keyword search parses.
 * US-557.
 *
 * docs/testing.md: a fixture for someone else's API is captured, never
 * written. The keyword search asks five questions, and this script answers
 * each one:
 *
 *   1. What is one page of a Google search limited to public groups and the
 *      past day, every field?
 *   2. What is `next_page`, and does page two repeat page one?
 *   3. What does a search that finds nothing return, and is it billed?
 *   4. What does one group post read by its address return, every field?
 *   5. What does a post that does not exist return, and is it billed?
 *
 * The vocabulary is in https://docs.scrapecreators.com/v1/google/search and
 * https://docs.scrapecreators.com/v1/facebook/post and costs nothing to read.
 * This provider bills an invalid parameter value, so nothing here tries one.
 *
 * Run it with your own key. It spends about five credits:
 *
 *     node packages/engine/src/sources/providers/scrapecreators/facebook-fixtures/capture-search.mjs
 *
 * It writes `search-*.json` and `post-*.json` into this folder, and adds its
 * rows to `manifest.json` and `ledger.json` without removing the group
 * captures' rows.
 *
 * Scrubbing names the containers: `author` on a post and on each comment,
 * every string inside it at any depth. A search result's `description` is
 * Google's snippet, and the first capture showed it names commenters ("Casey
 * Hays ▻ 3D Printing Community"); no pattern finds every name in free text,
 * so the snippet keeps its leading age label ("9 hours ago ... ") and the
 * rest is replaced. The title is the post's own first line and is kept, as
 * the group captures keep a post's text. Every fbcdn media address is a
 * signed URL that expires, so each one is replaced.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));

const searchEndpoint = "https://api.scrapecreators.com/v1/google/search";
const postEndpoint = "https://api.scrapecreators.com/v1/facebook/post";
const balanceEndpoint = "https://api.scrapecreators.com/v1/credit-balance";

const query = "3d printer recommend site:facebook.com/groups";
const nothing = "zqxjkv intentwatch qqqq site:facebook.com/groups";
/** A real public group (the group captures read it) and a post id no post has. */
const missingPost = "https://www.facebook.com/groups/856491544939621/posts/1/";

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
const scrubbedSnippet = "Scrubbed by capture-search.mjs: a snippet can name commenters.";
const ageLabel =
  /^(\d+ (?:minutes?|hours?|days?|weeks?) ago|[A-Z][a-z]{2} \d{1,2}, \d{4})( \.\.\. )?/;

function createScrubber() {
  const pseudonyms = new Map();

  function pseudonym(value) {
    if (!pseudonyms.has(value)) pseudonyms.set(value, `member-${pseudonyms.size + 1}`);
    return pseudonyms.get(value);
  }

  /** An author is a person, whatever fields it carries: every string goes, at any depth. */
  function scrubAuthor(author, key = "") {
    if (typeof author === "string") {
      if (author === "" || key === "__typename") return author;
      if (/^https:\/\/[^/]*fbcdn\.net\//.test(author)) return mediaPlaceholder;
      if (key === "url") return `https://www.facebook.com/${pseudonym(author)}`;
      return pseudonym(author);
    }
    if (Array.isArray(author)) return author.map((child) => scrubAuthor(child, key));
    if (author === null || typeof author !== "object") return author;
    return Object.fromEntries(
      Object.entries(author).map(([childKey, child]) => [childKey, scrubAuthor(child, childKey)]),
    );
  }

  /** The age label stays: it is the one part of a snippet the connector reads. */
  function scrubSnippet(value) {
    const age = value.match(ageLabel);
    return `${age ? `${age[1]} ... ` : ""}${scrubbedSnippet}`;
  }

  function scrub(value, key = "", inResults = false) {
    if (typeof value === "string") {
      if (inResults && key === "description") return scrubSnippet(value);
      return /^https:\/\/[^/]*fbcdn\.net\//.test(value) ? mediaPlaceholder : value;
    }
    if (key === "results" && Array.isArray(value)) {
      return value.map((result) =>
        result && typeof result === "object"
          ? Object.fromEntries(
              Object.entries(result).map(([childKey, child]) => [
                childKey,
                scrub(child, childKey, true),
              ]),
            )
          : result,
      );
    }
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

async function request(url) {
  const startedAt = Date.now();
  const response = await fetch(url, { headers: { "x-api-key": apiKey } });
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

// ------------------------------------------------------------- capturing

const manifest = JSON.parse(readFileSync(`${here}manifest.json`, "utf8"));
const ledger = JSON.parse(readFileSync(`${here}ledger.json`, "utf8"));

/** One call: balance before and after, the answer scrubbed and saved whole. */
async function capture(name, endpoint, params) {
  const before = await balance();
  const answer = await request(`${endpoint}?${new URLSearchParams(params)}`);
  const after = await balance();

  const scrubber = createScrubber();
  const body = scrubber.scrub(answer.body);
  writeFileSync(
    `${here}${name}.json`,
    `${JSON.stringify({ status: answer.status, body }, null, 2)}\n`,
  );

  const results = Array.isArray(answer.body?.results) ? answer.body.results.length : undefined;
  const row = {
    file: `${name}.json`,
    capturedAt: new Date().toISOString(),
    request: { endpoint, params },
    status: answer.status,
    ...(results === undefined ? {} : { results }),
    pseudonyms: scrubber.replaced(),
    elapsedMs: answer.elapsedMs,
  };
  const spent = before !== undefined && after !== undefined ? before - after : undefined;
  const cost = {
    file: `${name}.json`,
    creditsBefore: before,
    creditsAfter: after,
    spent,
    creditsCharged: answer.body?.credits_charged,
  };

  for (const [list, entry] of [
    [manifest, row],
    [ledger, cost],
  ]) {
    const at = list.findIndex((existing) => existing.file === entry.file);
    if (at === -1) list.push(entry);
    else list[at] = entry;
  }

  console.log(name, "status", answer.status, "results", results, "spent", spent);
  return answer;
}

const first = await capture("search-page-1", searchEndpoint, {
  query,
  date_posted: "last-day",
});
const next = first.body?.next_page;
if (next !== undefined && next !== null) {
  await capture("search-page-2", searchEndpoint, {
    query,
    date_posted: "last-day",
    page: String(next),
  });
}
await capture("search-nothing", searchEndpoint, { query: nothing, date_posted: "last-day" });

const firstPost = (first.body?.results ?? []).find((result) =>
  /facebook\.com\/groups\/[^/]+\/posts\/\d+/.test(result?.url ?? ""),
);
if (firstPost) await capture("post-read", postEndpoint, { url: firstPost.url });
await capture("post-missing", postEndpoint, { url: missingPost });

writeFileSync(`${here}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(`${here}ledger.json`, `${JSON.stringify(ledger, null, 2)}\n`);
