#!/usr/bin/env node
/**
 * Capture the SocialCrawl payloads the YouTube connector will parse.
 *
 * docs/testing.md: a fixture for someone else's API is captured, never
 * written. So this script exists before the parser does, and it stays
 * committed and re-runnable, because the next person to touch the parser needs
 * to be able to ask the provider again.
 *
 * Its own folder, not the X or LinkedIn one, for the hazard that split those
 * two: a shared `manifest.json` means a full run of either erases the other's
 * record of where its payloads came from.
 *
 * **US-034 crossed PLAN.md's rule to get here, and the catalogue is what made
 * it cheap to decide.** `/v1/utility/endpoints` answers for nothing, so the
 * question "can this platform be searched at all" — the one Bright Data and
 * ScrapeCreators failed for X — was settled before a credit was spent.
 *
 * Nine questions the documentation cannot settle, and each is a call below:
 *
 *   1. What is one search result on the wire? Every field, including the ones
 *      the parser will not read, because a fixture trimmed to today's parser
 *      stops being evidence tomorrow.
 *   2. Is `published_at` really derived from a relative label? The provider
 *      says it is approximate without `includeExtras`, measured up to four
 *      months off. A connector that applied `since` to that would drop fresh
 *      videos and keep stale ones, so this compares the two answers directly.
 *   3. Does `includeExtras=true` still cost one credit? Every extra on a
 *      metered API is a price question until it is measured.
 *   4. Does `/search/advanced` take `published_after` and honour it? If it
 *      does, `since` is the provider's problem rather than ours.
 *   5. Is there a cursor, and where? The answer is walked for every key that
 *      could be one, rather than looking up the documented name.
 *   6. What is one comment on the wire, and does it carry an exact timestamp?
 *   7. Does `order=newest` really page strictly older with no overlap? Two
 *      pages are fetched and their ids compared. ScrapeCreators claimed a
 *      similar guarantee for Reddit and was wrong by 33 comments.
 *   8. Is the first row of the first page a pinned comment older than the
 *      rest? The provider warns that it can be. A walk that stopped at the
 *      first out-of-window row would then return nothing.
 *   9. Does `searchTerm` filter server-side, and does it change the price?
 *
 * Plus two probes that should be free: a bad key, and a search that matches
 * nothing. Both are claims about billing, and a budget guard fed a wrong one
 * spends somebody's money.
 *
 * Run it with your own key. The default run makes about ten billed calls at
 * one credit each — roughly $0.081.
 *
 *     node packages/core/src/sources/providers/socialcrawl/youtube-fixtures/capture.mjs
 *     node .../capture.mjs --only=comments
 *
 * What it writes, into this folder:
 *
 *   <name>.json     one whole response body, with author identity scrubbed
 *   manifest.json   which request produced each file, and when
 *   ledger.json     what each call did to the account's credit balance
 *
 * **Read the fixtures before committing them.** The LinkedIn capture's first
 * run leaked real names past a scrubber that looked right, because it decided
 * what a person was by sniffing for fields that provider does not use.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));

const api = "https://www.socialcrawl.dev/v1/youtube";

const endpoints = {
  search: `${api}/search`,
  searchAdvanced: `${api}/search/advanced`,
  comments: `${api}/video/comments`,
};

/**
 * The query a monitor would generate.
 *
 * `flaky tests` is the two-word form that returned twenty on-topic posts on X
 * and ten on LinkedIn, so a fourth answer joins a comparison that has three.
 */
const keyword = "flaky tests";

/** A phrase that cannot occur, to see whether an empty search is refunded. */
const impossible = "zzqx flaky tests quantum sourdough parliament";

/** A term to look for inside one video's comments. Question 9. */
const commentTerm = "playwright";

// ---------------------------------------------------------------- the key

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
  console.error(
    "No SocialCrawl key. Set SOCIALCRAWL_API_KEY in .env. One key serves X, LinkedIn and YouTube.",
  );
  process.exit(1);
}

// ------------------------------------------------------------- scrubbing

/**
 * On YouTube a person is a channel, and a channel is public in a way a Reddit
 * account is not — but it is still identity, and we have no business
 * committing somebody's display name to this repository to prove our parser
 * reads a field.
 *
 * The video's own title and description stay. They are what the classifier
 * reads, and a fixture that scrubbed them would agree with any parser at all —
 * the mistake the LinkedIn run made in the other direction.
 */
const identityFields = new Set([
  "author",
  "authorText",
  "author_name",
  // The nested reply previews use YouTube's own camel-case names, which the
  // first run's rules did not carry. The audit found real handles in
  // `ext.preview_replies[].authorDisplayName`, so a name is listed in every
  // spelling the payload uses rather than in the one the top level happens to.
  "authorDisplayName",
  "authorChannelUrl",
  "channelName",
  "channel_name",
  "channelTitle",
  "handle",
  "customUrl",
  "custom_url",
  "username",
  "display_name",
]);

/**
 * Free text where a person wrote somebody else's handle. US-034.
 *
 * This is the leak no field rule catches. A commenter replies "@ChecklyHQ
 * thanks for the clarification" and a creator's description ends with
 * "‪@softwaretestingjournal‬ #flakytest", so the identity is *inside* the one
 * field the classifier reads and cannot be replaced wholesale.
 *
 * So the handle is rewritten in place and the sentence around it survives. The
 * fixture then still proves what the parser must prove — that it reads this
 * text and stores it — without committing somebody's account name to prove it.
 */
const textFields = new Set([
  "text",
  "text_original",
  "textDisplay",
  "textOriginal",
  "description",
  "content",
]);

function scrubHandlesInText(value, pseudonym) {
  // U+202A and friends: YouTube wraps a mention in bidirectional marks, and a
  // pattern that missed them would leave the handle beside an invisible
  // character rather than remove it.
  //
  // The leading boundary is what keeps an email address whole. `someone@x.com`
  // is identity too, but rewriting only the half after the `@` mangles the
  // text without hiding anybody — so a mention is recognised only where the
  // `@` opens a word.
  return value.replace(
    /(^|[\s\u202a-\u202e\u2066-\u2069([])[\u202a-\u202e\u2066-\u2069]*@([A-Za-z0-9_.-]{3,})/g,
    (_, before, handle) => `${before}@${pseudonym(handle)}`,
  );
}

/** Identity that arrives as a URL or an image. Scrubbed to one, so shape survives. */
const identityUrlFields = new Set([
  "authorThumbnail",
  "author_thumbnail",
  "avatar",
  "avatar_url",
  "avatarUrl",
  "channelThumbnail",
  "profile_url",
  "channel_url",
  "channelUrl",
]);

/** Containers that hold a whole person, so everything under them is identity. */
const personContainers = new Set(["author", "channel", "owner", "uploader", "user"]);

/** A channel avatar is served from these hosts and names the person it belongs to. */
function isAvatarUrl(value) {
  return /^https?:\/\/(yt\d\.ggpht\.com|[^/]*\.googleusercontent\.com)\//i.test(value);
}

/**
 * A channel URL carries identity in its path: `/channel/UC…`, `/@handle`,
 * `/c/<name>`, `/user/<name>`. A video URL does not — `watch?v=` is the id the
 * connector stores and deduplicates on, so it is kept whole.
 */
function scrubChannelUrl(value, pseudonym) {
  const match = value.match(
    /^(https?:\/\/(?:www\.)?youtube\.com)\/(@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)(.*)$/i,
  );
  if (!match) return undefined;

  const [, origin, path, tail] = match;
  return `${origin}/${pseudonym(path)}${tail}`;
}

/** A channel URL written inside free text, rather than in a field of its own. */
/**
 * An email address somebody typed into their own description.
 *
 * The audit found `qaquickprep@gmail.com` in a video description on the first
 * clean run. It is not a mention and no field names it, so neither rule above
 * catches it — and it is the most personal thing in the whole capture.
 *
 * The domain is kept because the shape is what a parser might one day read.
 * The local part is what identifies somebody.
 */
function scrubEmailsInText(value, pseudonym) {
  return value.replace(
    /\b([A-Za-z0-9_.+-]+)@([A-Za-z0-9-]+\.[A-Za-z0-9-.]+)\b/g,
    (_, local, domain) => `${pseudonym(local)}@${domain}`,
  );
}

function scrubChannelUrlsInText(value, pseudonym) {
  return value.replace(
    /(https?:\/\/(?:www\.)?youtube\.com)\/(@[^\s/?#]+|channel\/[^\s/?#]+|c\/[^\s/?#]+|user\/[^\s/?#]+)/gi,
    (_, origin, path) => `${origin}/${pseudonym(path)}`,
  );
}

function createScrubber() {
  const pseudonyms = new Map();
  let count = 0;

  function pseudonym(value) {
    if (!pseudonyms.has(value)) {
      count += 1;
      pseudonyms.set(value, `yt-channel-${count}`);
    }
    return pseudonyms.get(value);
  }

  function scrub(value, insidePerson = false) {
    if (Array.isArray(value)) return value.map((child) => scrub(child, insidePerson));
    if (value === null || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        const childIsPerson = insidePerson || personContainers.has(key);

        if (typeof child === "string" && child !== "") {
          if (identityFields.has(key)) return [key, pseudonym(child)];
          // `name` and `title` mean a channel inside a person and a video
          // outside one, so they are only scrubbed where they are identity.
          if ((key === "name" || key === "title") && childIsPerson) return [key, pseudonym(child)];
          if (identityUrlFields.has(key)) {
            return [key, `https://scrubbed.invalid/${pseudonym(child)}`];
          }
          if (isAvatarUrl(child)) return [key, `https://scrubbed.invalid/${pseudonym(child)}`];

          const url = scrubChannelUrl(child, pseudonym);
          if (url) return [key, url];

          // A handle somebody typed into their own words. The words stay.
          if (textFields.has(key) && (child.includes("@") || child.includes("youtube.com/"))) {
            return [
              key,
              scrubEmailsInText(
                scrubChannelUrlsInText(scrubHandlesInText(child, pseudonym), pseudonym),
                pseudonym,
              ),
            ];
          }
        }

        return [key, scrub(child, childIsPerson && typeof child === "object")];
      }),
    );
  }

  return { scrub: (value) => scrub(value), replaced: () => pseudonyms.size };
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

function url(endpoint, params) {
  return `${endpoint}?${new URLSearchParams(params)}`;
}

// ------------------------------------------------------------- capturing

const scrubber = createScrubber();
const manifest = [];
const ledger = [];

const numberAt = (body, key) => (typeof body?.[key] === "number" ? body[key] : undefined);

async function capture(name, target, options = {}) {
  const { status, body, elapsedMs } = await request(target, options);

  writeFileSync(`${here}${name}.json`, `${JSON.stringify(scrubber.scrub(body), null, 2)}\n`);

  manifest.push({ name, url: target, status, elapsedMs, capturedAt: new Date().toISOString() });
  ledger.push({
    name,
    creditsUsed: numberAt(body, "credits_used"),
    creditsRemaining: numberAt(body, "credits_remaining"),
    cached: body?.cached === true,
  });

  const items = body?.data?.items;
  console.log(
    `  ${name.padEnd(28)} ${status} ${String(elapsedMs).padStart(6)}ms ` +
      `credits=${numberAt(body, "credits_used") ?? "?"} ` +
      `remaining=${numberAt(body, "credits_remaining") ?? "?"} ` +
      `items=${Array.isArray(items) ? items.length : "-"}` +
      `${body?.cached === true ? " cached" : ""}`,
  );

  return body;
}

const only = process.argv.find((value) => value.startsWith("--only="))?.slice("--only=".length);
const wants = (group) => !only || only === group;

console.log(`\nCapturing SocialCrawl YouTube payloads into ${here}\n`);

// -- 1, 2, 3, 5: search, with and without the exact-date flag ---------------

let videoUrl;

if (wants("search")) {
  console.log("search:");
  const plain = await capture("search-plain", url(endpoints.search, { query: keyword }));
  await capture(
    "search-with-extras",
    url(endpoints.search, { query: keyword, includeExtras: "true" }),
  );
  await capture(
    "search-advanced",
    url(endpoints.searchAdvanced, {
      query: keyword,
      order: "date",
      published_after: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    }),
  );

  // A second page, to see whether the cursor exists and moves.
  const cursor = plain?.pagination?.next_cursor ?? plain?.data?.next_cursor;
  if (typeof cursor === "string" && cursor !== "") {
    await capture("search-page-2", url(endpoints.search, { query: keyword, cursor }));
  } else {
    console.log("  (no cursor on the first page; nothing to page to)");
  }

  const first = plain?.data?.items?.find((item) => item?.post?.url);
  videoUrl = first?.post?.url;
  console.log(`  video for the comment calls: ${videoUrl ?? "none found"}`);
}

// -- 6, 7, 8, 9: comments --------------------------------------------------

if (wants("comments")) {
  const target = process.env.CAPTURE_YOUTUBE_VIDEO ?? videoUrl;

  if (!target) {
    console.log("\ncomments: skipped — no video url. Set CAPTURE_YOUTUBE_VIDEO or run search too.");
  } else {
    console.log(`\ncomments on ${target}:`);
    const newest = await capture(
      "comments-newest",
      url(endpoints.comments, { url: target, order: "newest" }),
    );

    const cursor = newest?.pagination?.next_cursor ?? newest?.data?.next_cursor;
    if (typeof cursor === "string" && cursor !== "") {
      await capture(
        "comments-newest-page-2",
        url(endpoints.comments, { url: target, order: "newest", cursor }),
      );
    } else {
      console.log("  (no cursor; one page is the whole thread)");
    }

    await capture(
      "comments-search-term",
      url(endpoints.comments, { url: target, order: "newest", searchTerm: commentTerm }),
    );
  }
}

// -- the two probes that should be free ------------------------------------

if (wants("probes")) {
  console.log("\nprobes (expected free):");
  await capture("search-no-results", url(endpoints.search, { query: impossible }));
  await capture("credentials-rejected", url(endpoints.search, { query: keyword }), {
    key: "not-a-real-key",
  });
}

writeFileSync(`${here}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(`${here}ledger.json`, `${JSON.stringify(ledger, null, 2)}\n`);

const spent = ledger.reduce((total, entry) => total + (entry.creditsUsed ?? 0), 0);

console.log(`\n${manifest.length} files written. ${scrubber.replaced()} identities pseudonymised.`);
console.log(`Credits used, as the provider reported them: ${spent}.`);
console.log("Read the fixtures before you commit them. See the header.\n");
