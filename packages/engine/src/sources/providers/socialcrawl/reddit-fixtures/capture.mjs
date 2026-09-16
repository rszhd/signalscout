#!/usr/bin/env node
/**
 * Capture the SocialCrawl payloads the Reddit connector parses. US-031.
 *
 * Its own folder, for the hazard that split the X and LinkedIn captures: a
 * shared `manifest.json` means a full run of either erases the other's record.
 *
 * **The reason this provider is worth a third Reddit connector is one
 * endpoint.** `/v1/reddit/subreddit/search` takes a subreddit *and* a query,
 * and neither Bright Data nor ScrapeCreators has it. US-022 measured why that
 * matters: a keyword across all of Reddit brought back r/AllFinraExams and
 * r/islam for "end to end tests keep breaking", and one subreddit brought back
 * fifty posts that were all on topic but ignored the monitor's words entirely.
 * A keyword inside a chosen subreddit is the mode neither of those is.
 *
 * **The price runs the wrong way and relevance has to pay for it.** A
 * SocialCrawl credit is 8,118 micro-dollars against a ScrapeCreators request's
 * 1,880, so every call here costs 4.3 times its equivalent. This capture is how
 * "is it worth it" stops being an opinion.
 *
 * Four questions the documentation cannot settle:
 *
 *   1. What is one Reddit post on the wire here? The provider wraps every
 *      platform in one envelope, so the guess is that it looks like the X and
 *      YouTube ones — and a guess is what this checks.
 *   2. Does `/v1/reddit/subreddit/search` actually narrow to the subreddit, or
 *      is it a keyword search with a filter that leaks?
 *   3. Is there a cursor, and does it move? A documented cursor is not a
 *      tested one, and this provider's `has_more` has now been measured wrong
 *      twice.
 *   4. Does the provider's own warning hold — that Reddit search here is slow,
 *      "a 10 to 12s median with a tail past 30s"? A connector's timeout is set
 *      from that number.
 *
 * The comment endpoint is deliberately **not** captured. US-020 measured it at
 * 5 credits against ScrapeCreators' 1 for the same thread, so the decision was
 * made against it; spending five more to photograph it would be paying to prove
 * a decision twice. Reddit replies stay with ScrapeCreators.
 *
 *     node packages/core/src/sources/providers/socialcrawl/reddit-fixtures/capture.mjs
 *
 * Four billed calls at one credit each, about $0.032, plus one free refusal.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));
const api = "https://www.socialcrawl.dev/v1/reddit";

const endpoints = {
  search: `${api}/search`,
  subreddit: `${api}/subreddit`,
  subredditSearch: `${api}/subreddit/search`,
};

/** The keyword four other connectors have been polled with. */
const keyword = "flaky tests";
/** The subreddit US-022 measured as all on topic. */
const subreddit = "softwaretesting";

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

const apiKey = process.env.SOCIALCRAWL_API_KEY || readEnvFile(`${root}.env`).SOCIALCRAWL_API_KEY;

if (!apiKey) {
  console.error("No SocialCrawl key. Set SOCIALCRAWL_API_KEY in .env.");
  process.exit(1);
}

/**
 * Reddit identity, and the text people write it into.
 *
 * Both halves are needed and the second is the one two captures have now
 * leaked: a username in a field is caught by naming the field, and a `u/name`
 * inside a comment body is not. The post text stays otherwise, because it is
 * what the classifier reads.
 */
const identityFields = new Set(["author", "author_fullname", "username", "display_name"]);
const identityUrlFields = new Set(["author_url", "avatar_url", "profile_url"]);
const textFields = new Set(["text", "selftext", "body", "content", "title"]);

function createScrubber() {
  const pseudonyms = new Map();
  let count = 0;

  const pseudonym = (value) => {
    if (!pseudonyms.has(value)) pseudonyms.set(value, `redditor-${++count}`);
    return pseudonyms.get(value);
  };

  const scrubMentions = (value) =>
    value.replace(
      /(^|[\s([])(u\/|\/u\/)([A-Za-z0-9_-]{3,20})\b/g,
      (_, before, prefix, name) => `${before}${prefix}${pseudonym(name)}`,
    );

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
          if (textFields.has(key) && /u\//.test(child)) return [key, scrubMentions(child)];
        }
        return [key, scrub(child)];
      }),
    );
  }

  return { scrub, replaced: () => pseudonyms.size };
}

const scrubber = createScrubber();
const manifest = [];
const ledger = [];

async function capture(name, endpoint, params, { key = apiKey, note } = {}) {
  const target = `${endpoint}?${new URLSearchParams(params)}`;
  const startedAt = Date.now();
  const response = await fetch(target, { headers: { "x-api-key": key } });
  const text = await response.text();
  const elapsedMs = Date.now() - startedAt;

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  writeFileSync(
    `${here}${name}.json`,
    `${JSON.stringify({ httpStatus: response.status, body: scrubber.scrub(body) }, null, 2)}\n`,
  );

  const items = body?.data?.items;
  manifest.push({ name, url: target, status: response.status, elapsedMs, note: note ?? null });
  ledger.push({
    name,
    creditsUsed: body?.credits_used ?? null,
    creditsRemaining: body?.credits_remaining ?? null,
    cached: body?.cached === true,
  });

  console.log(
    `  ${name.padEnd(26)} ${response.status} ${String(elapsedMs).padStart(6)}ms ` +
      `credits=${body?.credits_used ?? "?"} left=${body?.credits_remaining ?? "?"} ` +
      `items=${Array.isArray(items) ? items.length : "-"}`,
  );

  return body;
}

console.log(`\nCapturing SocialCrawl Reddit payloads into ${here}\n`);

const first = await capture("search-keyword", endpoints.search, { query: keyword, sort: "new" });

const cursor = first?.pagination?.next_cursor ?? first?.data?.next_cursor;
if (typeof cursor === "string" && cursor !== "") {
  await capture("search-keyword-page-2", endpoints.search, {
    query: keyword,
    sort: "new",
    cursor,
  });
} else {
  console.log("  (no cursor on page one; nothing to page to)");
}

await capture("subreddit-posts", endpoints.subreddit, { subreddit, sort: "new" });

/**
 * The endpoint this connector exists for: a keyword inside one subreddit.
 *
 * The check is not that it answers. It is whether every post it returns is
 * from the subreddit asked for — a filter that leaks would be a keyword search
 * wearing a subreddit's name, at 4.3 times a ScrapeCreators call.
 */
const scoped = await capture("subreddit-search", endpoints.subredditSearch, {
  subreddit,
  query: keyword,
  sort: "new",
});

await capture(
  "credentials-rejected",
  endpoints.search,
  { query: keyword },
  { key: "this-key-is-not-real", note: "expected free: refused before the query is read" },
);

writeFileSync(`${here}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(`${here}ledger.json`, `${JSON.stringify(ledger, null, 2)}\n`);

const posts = scoped?.data?.items ?? [];
const elsewhere = posts
  .map((item) => item?.post?.ext?.subreddit ?? item?.post?.channel)
  .filter((name) => name && name.toLowerCase() !== subreddit.toLowerCase());

console.log(`\nsubreddit/search returned ${posts.length} posts.`);
console.log(
  elsewhere.length === 0
    ? `  every one from r/${subreddit}: the scope holds.`
    : `  ${elsewhere.length} from elsewhere: ${[...new Set(elsewhere)].join(", ")}`,
);

const spent = ledger.reduce((total, entry) => total + (entry.creditsUsed ?? 0), 0);
console.log(`\n${manifest.length} files. ${scrubber.replaced()} identities pseudonymised.`);
console.log(`Credits used, as the provider reported them: ${spent}.`);
console.log("Read the fixtures before you commit them.\n");
