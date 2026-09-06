#!/usr/bin/env node
/**
 * Capture the SocialCrawl payloads the TikTok connector parses. US-044.
 *
 * Its own folder, for the hazard that split the X and LinkedIn captures: a
 * shared `manifest.json` means a full run of either erases the other's record.
 *
 * **The question this run has to answer is not whether the payload parses.**
 * US-034 measured that a YouTube search returns publishers rather than people —
 * every one of the first twelve results for `flaky tests` was a tutorial — and
 * TikTok is further from text than YouTube, not closer. There is no description
 * of any length and a caption is a line. So the honest possibility is that this
 * platform is cheap because there is little text in it, and the only way to
 * know is to read what the comments actually say.
 *
 * Six questions, and the last two are the ones that decide the platform:
 *
 *   1. What is one video on the wire? Every field, including the ones the
 *      parser will not read, because a fixture trimmed to today's parser stops
 *      being evidence tomorrow.
 *   2. `/search` and `/search/top` are both one credit and the catalogue does
 *      not say how they differ. One may be relevance-ranked and one recent, and
 *      a monitor wants what was said since it last looked.
 *   3. Does a result carry a date the provider stands behind? US-034 found
 *      YouTube's derived dates drifting a median of 62 days.
 *   4. Is there a cursor, and does it move? Two of this provider's
 *      completeness flags have now been measured wrong.
 *   5. What is one comment on the wire, and does it match the shared
 *      `CommentList` shape the X and YouTube connectors already read?
 *   6. **How long is a TikTok comment?** The answer decides whether this
 *      platform can carry a lead at all.
 *
 *     node packages/core/src/sources/providers/socialcrawl/tiktok-fixtures/capture.mjs
 *
 * About six billed calls at one credit each — $0.05 — plus one free refusal.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));
const api = "https://www.socialcrawl.dev/v1/tiktok";

const endpoints = {
  search: `${api}/search`,
  searchTop: `${api}/search/top`,
  comments: `${api}/post/comments`,
};

/** The two words four other connectors have been polled with. */
const keyword = "flaky tests";
/** A phrase closer to how somebody speaks on this platform. */
const spoken = "my tests keep failing";

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
 * Identity, in fields and in the text people write it into.
 *
 * Both halves are needed and the second is the one two captures have leaked. A
 * handle in a field is caught by naming the field; an "@someone" inside a
 * comment is not, and a comment is the field the classifier reads.
 */
const identityFields = new Set([
  "author",
  "author_name",
  "authorName",
  "nickname",
  "unique_id",
  "uniqueId",
  "username",
  "display_name",
  "handle",
]);
const identityUrlFields = new Set([
  "avatar_url",
  "avatarUrl",
  "avatar",
  "profile_url",
  "author_url",
]);
const personContainers = new Set(["author", "user", "creator", "owner"]);
const textFields = new Set(["text", "caption", "description", "content", "desc"]);

function createScrubber() {
  const pseudonyms = new Map();
  let count = 0;

  const pseudonym = (value) => {
    if (!pseudonyms.has(value)) pseudonyms.set(value, `tiktok-user-${++count}`);
    return pseudonyms.get(value);
  };

  // A mention opens a word, so an email address is left whole.
  const scrubHandles = (value) =>
    value.replace(
      /(^|[\s([])@([A-Za-z0-9_.]{2,24})\b/g,
      (_, before, handle) => `${before}@${pseudonym(handle)}`,
    );

  const scrubProfileUrls = (value) =>
    value.replace(
      /(https?:\/\/(?:www\.)?tiktok\.com)\/@([A-Za-z0-9_.]+)/gi,
      (_, origin, handle) => `${origin}/@${pseudonym(handle)}`,
    );

  function scrub(value, insidePerson = false) {
    if (Array.isArray(value)) return value.map((child) => scrub(child, insidePerson));
    if (value === null || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        const childIsPerson = insidePerson || personContainers.has(key);

        if (typeof child === "string" && child !== "") {
          if (identityFields.has(key)) return [key, pseudonym(child)];
          if ((key === "name" || key === "title") && childIsPerson) return [key, pseudonym(child)];
          if (identityUrlFields.has(key)) {
            return [key, `https://scrubbed.invalid/${pseudonym(child)}`];
          }
          if (textFields.has(key) && (child.includes("@") || child.includes("tiktok.com/@"))) {
            return [key, scrubProfileUrls(scrubHandles(child, pseudonym))];
          }
          if (/^https?:\/\/(?:www\.)?tiktok\.com\/@/i.test(child)) {
            return [key, scrubProfileUrls(child)];
          }
        }

        return [key, scrub(child, childIsPerson && typeof child === "object")];
      }),
    );
  }

  return { scrub: (value) => scrub(value), replaced: () => pseudonyms.size };
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
    `  ${name.padEnd(24)} ${response.status} ${String(elapsedMs).padStart(6)}ms ` +
      `credits=${body?.credits_used ?? "?"} left=${body?.credits_remaining ?? "?"} ` +
      `items=${Array.isArray(items) ? items.length : "-"}`,
  );

  return body;
}

console.log(`\nCapturing SocialCrawl TikTok payloads into ${here}\n`);

const plain = await capture("search-keyword", endpoints.search, { query: keyword });
await capture(
  "search-top",
  endpoints.searchTop,
  { query: keyword },
  {
    note: "the other search endpoint, to see how it differs",
  },
);
await capture(
  "search-spoken",
  endpoints.search,
  { query: spoken },
  {
    note: "a phrase closer to how somebody talks here",
  },
);

const cursor = plain?.pagination?.next_cursor ?? plain?.data?.next_cursor;
if (typeof cursor === "string" && cursor !== "") {
  await capture("search-page-2", endpoints.search, { query: keyword, cursor });
} else {
  console.log("  (no cursor on page one)");
}

/**
 * Comments on the video with the most of them, because a video with none says
 * nothing about whether a comment can carry a lead.
 */
const posts = plain?.data?.items ?? [];
const busiest = posts
  .map((item) => item?.post)
  .filter((post) => post?.url)
  .sort((left, right) => (right?.engagement?.comments ?? 0) - (left?.engagement?.comments ?? 0))[0];

if (!busiest) {
  console.log("\ncomments: skipped — the search returned no post with a url.");
} else {
  console.log(`\ncomments on ${busiest.url} (${busiest.engagement?.comments ?? "?"} claimed):`);
  const first = await capture("comments-page-1", endpoints.comments, { url: busiest.url });

  const next = first?.pagination?.next_cursor ?? first?.data?.next_cursor;
  if (typeof next === "string" && next !== "") {
    await capture("comments-page-2", endpoints.comments, { url: busiest.url, cursor: next });
  } else {
    console.log("  (no cursor: one page was the whole thread)");
  }
}

await capture(
  "credentials-rejected",
  endpoints.search,
  { query: keyword },
  {
    key: "this-key-is-not-real",
    note: "expected free",
  },
);

writeFileSync(`${here}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(`${here}ledger.json`, `${JSON.stringify(ledger, null, 2)}\n`);

const spent = ledger.reduce((total, entry) => total + (entry.creditsUsed ?? 0), 0);
console.log(`\n${manifest.length} files. ${scrubber.replaced()} identities pseudonymised.`);
console.log(`Credits used, as the provider reported them: ${spent}.`);
console.log("Read the fixtures before you commit them. See the header.\n");
