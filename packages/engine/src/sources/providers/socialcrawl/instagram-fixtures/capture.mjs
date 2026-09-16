#!/usr/bin/env node
/**
 * Capture the SocialCrawl payloads the Instagram connector parses. US-049.
 *
 * Its own folder, for the hazard that split the X and LinkedIn captures: a
 * shared `manifest.json` means a full run of either erases the other's record.
 *
 * **The question is not whether the payload parses. It is whether the lead is
 * behind the expensive endpoint.** The free catalogue, read on 2026-09-06, says
 * a reel search is 1 credit and a comment page is 5 — five times TikTok's and
 * YouTube's, and the same as a whole LinkedIn search. US-034 and US-044 both
 * measured that a video search returns publishers rather than people, so if that
 * holds here then everything worth reading on this platform sits behind the
 * 5-credit call and the 1-credit one is the part that does not carry it.
 *
 * Nine questions. The catalogue answered none of them; it only says what the
 * provider intends.
 *
 *   1. What is one reel on the wire? Every field, including the ones the parser
 *      will not read, because a fixture trimmed to today's parser stops being
 *      evidence tomorrow.
 *   2. Does a technical query work here at all? US-044 measured that on TikTok
 *      `flaky tests` returns dandruff and school exams, because the words mean
 *      something else. Instagram is the same kind of place.
 *   3. Does the search page, and does page two differ from page one? The
 *      catalogue calls the paging style `page` rather than a cursor, and warns
 *      that the ordering is relevance and is *not stable between calls*. So this
 *      run measures the overlap rather than trusting either claim.
 *   4. Does a result carry a date the provider stands behind? US-034 found
 *      YouTube's derived dates drifting a median of 62 days.
 *   5. What does `date_posted` do? The catalogue says a filtered search is
 *      served by a *different upstream surface*. A different surface may differ
 *      in more than the one field the catalogue admits it drops.
 *   6. Is the 5-credit hashtag search worth five times the reel search?
 *   7. What is one comment on the wire, and does it match the shared
 *      `CommentList` shape the X, YouTube and TikTok connectors already read?
 *   8. `sort=top` against `sort=recent`. The catalogue warns that a `top` walk
 *      starts repeating comments once it pages past the ranked head. That is a
 *      claim about somebody's bill — 5 credits for a page of duplicates — so it
 *      is measured here rather than believed.
 *   9. **How long is an Instagram comment?** At 5 credits a page this is the
 *      number that decides whether the platform is worth polling.
 *
 *     node .../instagram-fixtures/capture.mjs           # 24 credits, all nine
 *     node .../instagram-fixtures/capture.mjs --lean    # 14 credits, seven
 *
 * About 24 billed credits — roughly $0.20 — plus one free refusal.
 *
 * `--lean` drops the two 5-credit calls that answer a question rather than
 * feeding the parser: the hashtag search (question 6) and the second `top`
 * comment page (question 8). It costs 14 credits, and it leaves those two
 * questions open rather than answered — say so in the Log rather than letting a
 * cheaper run read as a complete one.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lean = process.argv.includes("--lean");

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));
const api = "https://www.socialcrawl.dev/v1/instagram";

const endpoints = {
  searchReels: `${api}/search/reels`,
  searchHashtag: `${api}/search/hashtag`,
  comments: `${api}/post/comments`,
};

/** The two words five other connectors have been polled with, for comparison. */
const keyword = "flaky tests";
/**
 * A consumer query. US-044 measured that this is the shape of monitor that
 * finds people on a video platform: somebody must describe a condition to get a
 * useful answer, so they write the description out.
 */
const consumer = "skincare for acne scars";
const hashtag = "acnescars";

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
 *
 * `username` is listed because this platform puts it at `post.author.username`
 * and the catalogue says every search row carries it.
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
  "full_name",
  "fullName",
  "handle",
  "owner_username",
]);
const identityUrlFields = new Set([
  "avatar_url",
  "avatarUrl",
  "avatar",
  "profile_url",
  "profile_pic_url",
  "author_url",
]);
const personContainers = new Set(["author", "user", "creator", "owner"]);
const textFields = new Set(["text", "caption", "description", "content", "desc", "bio"]);

function createScrubber() {
  const pseudonyms = new Map();
  let count = 0;

  const pseudonym = (value) => {
    if (!pseudonyms.has(value)) pseudonyms.set(value, `instagram-user-${++count}`);
    return pseudonyms.get(value);
  };

  // A mention opens a word, so an email address is left whole.
  const scrubHandles = (value) =>
    value.replace(
      /(^|[\s([])@([A-Za-z0-9_.]{2,30})\b/g,
      (_, before, handle) => `${before}@${pseudonym(handle)}`,
    );

  /**
   * Contact details a business puts in its own caption.
   *
   * The handle rules above deliberately skip an email, because a mention opens
   * a word and `info@clinic.com` is not a mention. That left a clinic's real
   * email and two phone numbers in a committed fixture on the first run — read
   * out of the file by eye, which is the check that keeps catching this. None
   * of it is evidence about the wire format, so it goes.
   */
  const scrubContacts = (value) =>
    value
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "contact@scrubbed.invalid")
      .replace(/\+?\d[\d\s().-]{7,}\d/g, "+00 0000 0000");

  const scrubProfileUrls = (value) =>
    value.replace(
      /(https?:\/\/(?:www\.)?instagram\.com)\/(?!p\/|reel\/|reels\/|tv\/|explore\/)([A-Za-z0-9_.]+)/gi,
      (_, origin, handle) => `${origin}/${pseudonym(handle)}`,
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
          if (textFields.has(key)) {
            return [key, scrubContacts(scrubProfileUrls(scrubHandles(child)))];
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

const idsOf = (body, pick) =>
  (body?.data?.items ?? []).map((item) => pick(item)).filter((id) => typeof id === "string");
const postIds = (body) => idsOf(body, (item) => item?.post?.id ?? item?.id);
const commentIds = (body) => idsOf(body, (item) => item?.comment?.id ?? item?.id);

function overlap(left, right) {
  const seen = new Set(left);
  return right.filter((id) => seen.has(id)).length;
}

console.log(`\nCapturing SocialCrawl Instagram payloads into ${here}\n`);

console.log("search, 1 credit each:");
await capture(
  "search-keyword",
  endpoints.searchReels,
  { query: keyword },
  { note: "the words five other connectors were polled with" },
);
const first = await capture(
  "search-consumer",
  endpoints.searchReels,
  { query: consumer },
  { note: "a query whose customers must describe a condition" },
);

/**
 * Page two, and whether it is page two.
 *
 * The catalogue calls this paging `page` and says the ordering is relevance and
 * unstable. Both claims are read off the overlap below rather than believed.
 */
const cursor = first?.pagination?.next_cursor ?? first?.data?.next_cursor;
let second;
if (cursor !== undefined && cursor !== null && `${cursor}` !== "") {
  second = await capture("search-page-2", endpoints.searchReels, {
    query: consumer,
    cursor: `${cursor}`,
  });
} else {
  console.log("  (no cursor on page one)");
}

await capture(
  "search-dated",
  endpoints.searchReels,
  { query: consumer, date_posted: "last-month" },
  { note: "the catalogue says a filtered search comes from a different surface" },
);

if (lean) {
  console.log("\nhashtag: skipped (--lean). Question 6 stays open.");
} else {
  console.log("\nhashtag, 5 credits:");
  await capture(
    "search-hashtag",
    endpoints.searchHashtag,
    { hashtag, type: "recent" },
    { note: "five times the reel search; is it worth it" },
  );
}

/**
 * Comments on the reel with the most of them, because a reel with none says
 * nothing about whether a comment here can carry a lead.
 */
const busiest = (first?.data?.items ?? [])
  .map((item) => item?.post ?? item)
  .filter((post) => post?.url)
  .sort((left, right) => (right?.engagement?.comments ?? 0) - (left?.engagement?.comments ?? 0))[0];

let top;
let topPage2;
let recent;

if (!busiest) {
  console.log("\ncomments: skipped — the search returned no post with a url.");
} else {
  console.log(
    `\ncomments on ${busiest.url} (${busiest.engagement?.comments ?? "?"} claimed), 5 credits each:`,
  );
  top = await capture("comments-top", endpoints.comments, { url: busiest.url, sort: "top" });

  const next = top?.pagination?.next_cursor ?? top?.data?.next_cursor;
  if (lean) {
    console.log("  (page 2 skipped: --lean. Question 8 stays open.)");
  } else if (typeof next === "string" && next !== "") {
    topPage2 = await capture(
      "comments-top-page-2",
      endpoints.comments,
      { url: busiest.url, sort: "top", cursor: next },
      { note: "the catalogue warns a top walk repeats past the ranked head" },
    );
  } else {
    console.log("  (no cursor: one page was the whole thread)");
  }

  recent = await capture(
    "comments-recent",
    endpoints.comments,
    { url: busiest.url, sort: "recent" },
    { note: "newest-first, which the catalogue says to use for a whole walk" },
  );
}

await capture(
  "credentials-rejected",
  endpoints.searchReels,
  { query: keyword },
  { key: "this-key-is-not-real", note: "expected free" },
);

writeFileSync(`${here}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(`${here}ledger.json`, `${JSON.stringify(ledger, null, 2)}\n`);

/**
 * The two measurements this run exists for.
 *
 * Everything above is a fixture. These are the answers: whether paging buys new
 * posts, and whether a comment here is long enough to describe a problem.
 */
console.log("\n--- what the run measured ---");

if (second) {
  const one = postIds(first);
  const two = postIds(second);
  console.log(
    `search paging: page 1 held ${one.length}, page 2 held ${two.length}, ` +
      `${overlap(one, two)} of page 2 were already on page 1.`,
  );
}

if (top && topPage2) {
  const one = commentIds(top);
  const two = commentIds(topPage2);
  console.log(
    `top walk: page 1 held ${one.length}, page 2 held ${two.length}, ` +
      `${overlap(one, two)} repeated. The catalogue predicted repeats.`,
  );
}

for (const [label, body] of [
  ["top", top],
  ["recent", recent],
]) {
  const lengths = (body?.data?.items ?? [])
    .map((item) => (item?.comment ?? item)?.text)
    .filter((value) => typeof value === "string")
    .map((value) => value.length)
    .sort((left, right) => left - right);

  if (lengths.length === 0) continue;

  const median = lengths[Math.floor(lengths.length / 2)];
  const overSixty = lengths.filter((length) => length > 60).length;
  console.log(
    `comment length (${label}): ${lengths.length} comments, median ${median} characters, ` +
      `${overSixty} over sixty. TikTok's skincare video was median 54, 22 of 49 over sixty.`,
  );
}

const spent = ledger.reduce((total, entry) => total + (entry.creditsUsed ?? 0), 0);
console.log(`\n${manifest.length} files. ${scrubber.replaced()} identities pseudonymised.`);
console.log(`Credits used, as the provider reported them: ${spent}.`);
console.log("Read the fixtures before you commit them. See the header.\n");
