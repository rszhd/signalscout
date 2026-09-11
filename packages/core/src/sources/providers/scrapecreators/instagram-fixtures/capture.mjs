#!/usr/bin/env node
/**
 * Capture the ScrapeCreators payloads an Instagram connector would parse.
 *
 * docs/testing.md: a fixture for someone else's API is captured, never
 * written. So this script exists before the parser does, and it stays
 * committed and re-runnable.
 *
 * **This platform has two candidate endpoints and they fail in opposite
 * directions, so the run asks both.** That is why this capture is shaped
 * differently from the TikTok and YouTube ones beside it.
 *
 *   `/v1/instagram/search/popular` is Instagram's own. The provider scrapes
 *   the public `/popular/{query}` page, so nothing stands between us and the
 *   platform.
 *
 *   `/v2/instagram/reels/search` is Google's index of Instagram, in the
 *   provider's own words: "best-effort rather than a complete Instagram-native
 *   search", with a note that recent-hour and recent-day windows are missing
 *   "because Google does not index Instagram reels reliably enough". US-055
 *   dropped a built and passing LinkedIn connector for that exact dependency.
 *
 * US-120 asks these questions. Each is asked of whichever endpoint can answer
 * it, and the Log says which:
 *
 *   1. What is one post on the wire, every field.
 *   2. Is the id the one SocialCrawl returns? Two providers that disagree
 *      about identity store and bill the same reel twice.
 *   3. **Does a post carry a date at all?** A monitor cuts on `since`, and a
 *      post with no timestamp cannot be cut, cannot be ordered and cannot be
 *      shown with a date beside it.
 *   4. US-049 fault 1: does a search with no window return five years of
 *      posts?
 *   5. US-049 fault 2: is `has_more` true beside an empty page?
 *   6. US-049 fault 3: which comment fields are null on every comment?
 *   7. What does a search matching nothing return, and is it billed?
 *   8. What is the cursor, and what happens past the documented last page?
 *   9. What does a refused key say, and is a credential probe free?
 *  10. What do comments cost, how many arrive, and do they carry an id, a date
 *      and a permalink? On Instagram the lead is in the comments more often
 *      than in the caption.
 *
 * Run it with your own key. It spends about ten credits:
 *
 *     node packages/core/src/sources/providers/scrapecreators/instagram-fixtures/capture.mjs
 *     node .../capture.mjs --only=reels
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));

const api = "https://api.scrapecreators.com";

const endpoints = {
  popular: `${api}/v1/instagram/search/popular`,
  reels: `${api}/v2/instagram/reels/search`,
  comments: `${api}/v2/instagram/post/comments`,
};

/** The keyword the SocialCrawl Instagram capture used, so one question is asked. */
const keyword = "flaky tests";

/** A phrase that cannot occur. Question 7 is what this costs. */
const impossibleKeyword = "zqxjkv wobblefish intentwatch nonexistent phrase";

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
  console.error("No ScrapeCreators key. Set SCRAPECREATORS_API_KEY in .env.");
  process.exit(1);
}

// ------------------------------------------------------------- scrubbing

/**
 * Field names read off a real answer before this list was written. US-049's
 * LinkedIn capture guessed at what a person looks like and let real names
 * through.
 */
const identityFields = new Set([
  "username",
  "full_name",
  "biography",
  // Instagram's primary key for a person, under a name that does not say so.
  // It survived the first run because the list was written from the fields a
  // reel's `owner` carries, and a comment's `user` carries one more.
  "pk",
]);

/** Containers whose every field names one person. */
const personContainers = new Set(["owner", "user", "author"]);

/**
 * Instagram's media addresses are signed CDN URLs with an expiry in the query
 * string. They are most of the bytes and they stop being evidence within
 * hours, so each keeps its key and its type and loses the signature.
 */
const mediaFields = new Set([
  "display_url",
  "thumbnail_src",
  "video_url",
  "profile_pic_url",
  "profile_pic_url_hd",
]);

const scrubbedText = "Scrubbed by capture.mjs. See docs/testing.md.";

function createScrubber() {
  const pseudonyms = new Map();
  let count = 0;

  function pseudonym(value) {
    if (!pseudonyms.has(value)) {
      count += 1;
      pseudonyms.set(value, `instagrammer-${count}`);
    }
    return pseudonyms.get(value);
  }

  function scrub(value, insidePerson = false) {
    if (Array.isArray(value)) return value.map((child) => scrub(child, insidePerson));
    if (value === null || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (mediaFields.has(key) && typeof child === "string") {
          return [key, "https://scrubbed.invalid/media-url-expired.bin"];
        }

        if (typeof child === "string" && child !== "") {
          if (identityFields.has(key)) return [key, pseudonym(child)];

          // An owner's `id` is a person. A post's `id` is the thing question 2
          // is about, so only the one inside a person container is replaced.
          if (insidePerson && key === "id") return [key, pseudonym(child)];
          if (insidePerson && key === "description") return [key, scrubbedText];

          // A caption and a comment are the text this product classifies, so
          // they are kept — and people write handles into both.
          if (child.includes("@")) {
            return [
              key,
              child.replace(/@([A-Za-z0-9._]{2,})/g, (_m, handle) => `@${pseudonym(handle)}`),
            ];
          }
        }

        return [key, scrub(child, insidePerson || personContainers.has(key))];
      }),
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

function url(endpoint, params) {
  return `${endpoint}?${new URLSearchParams(params)}`;
}

// ------------------------------------------------------------- capturing

const written = [];
const ledger = [];
const failures = [];

function creditsRemaining(body) {
  const value = body?.credits_remaining;
  return typeof value === "number" ? value : undefined;
}

function creditsCharged(body) {
  const value = body?.credits_charged;
  return typeof value === "number" ? value : undefined;
}

function save(name, payload, request_) {
  const scrubber = createScrubber();
  const scrubbed = scrubber.scrub(payload);
  const path = `${here}${name}.json`;

  writeFileSync(path, `${JSON.stringify(scrubbed, null, 2)}\n`);

  written.push({
    file: `${name}.json`,
    request: request_,
    capturedAt: new Date().toISOString(),
    identitiesReplaced: scrubber.replaced(),
    bytes: statSync(path).size,
  });

  console.log(
    `  wrote ${name}.json (${scrubber.replaced()} identities scrubbed, ` +
      `${Math.round(statSync(path).size / 1024)} KiB)`,
  );
}

async function capture(name, endpoint, params, options = {}) {
  console.log(`\n${name}`);

  const target = url(endpoint, params);
  const answer = await request(target, options);

  ledger.push({
    call: name,
    httpStatus: answer.status,
    elapsedMs: answer.elapsedMs,
    creditsCharged: creditsCharged(answer.body) ?? null,
    creditsRemaining: creditsRemaining(answer.body) ?? null,
    note: options.note ?? null,
  });

  console.log(
    `  ${answer.status} in ${answer.elapsedMs} ms` +
      `, charged ${creditsCharged(answer.body) ?? "(not reported)"}` +
      `, ${creditsRemaining(answer.body) ?? "(not reported)"} left`,
  );

  save(
    name,
    { httpStatus: answer.status, body: answer.body },
    {
      method: "GET",
      url: target,
      ...(options.note ? { note: options.note } : {}),
    },
  );

  return answer;
}

// ------------------------------------------------- reading what came back

const postsOf = (body) => (Array.isArray(body?.posts) ? body.posts : []);
const reelsOf = (body) => (Array.isArray(body?.reels) ? body.reels : []);

/**
 * Question 3, and it is the one that decides the endpoint.
 *
 * A monitor cuts on `since`. A post with no timestamp cannot be cut, cannot be
 * ordered, and cannot be shown with a date beside it in the inbox.
 */
function describeDates(name, items) {
  const dated = items.filter((item) => typeof item?.taken_at === "string");

  if (dated.length === 0) {
    console.log(`  ${name}: ${items.length} items and NOT ONE carries a date`);
    return;
  }

  const times = dated.map((item) => Date.parse(item.taken_at)).filter(Number.isFinite);
  console.log(
    `  ${name}: ${dated.length} of ${items.length} dated, ` +
      `${new Date(Math.min(...times)).toISOString().slice(0, 10)} to ` +
      `${new Date(Math.max(...times)).toISOString().slice(0, 10)}`,
  );
}

function describeCaptions(name, items) {
  const lengths = items
    .map((item) => String(item?.caption ?? "").length)
    .filter((length) => length > 0)
    .sort((a, b) => a - b);

  console.log(
    lengths.length === 0
      ? `  ${name}: no captions`
      : `  ${name}: caption ${lengths[0]} to ${lengths[lengths.length - 1]}, ` +
          `median ${lengths[lengths.length >> 1]}`,
  );
}

/** Question 6: which comment fields are null on every comment. */
function describeComments(name, comments) {
  if (comments.length === 0) {
    console.log(`  ${name}: no comments`);
    return;
  }

  const keys = new Set();
  for (const comment of comments) for (const key of Object.keys(comment)) keys.add(key);

  const alwaysMissing = [...keys].filter((key) =>
    comments.every((comment) => comment[key] === null || comment[key] === undefined),
  );

  const dated = comments.filter((comment) =>
    ["taken_at", "created_at", "timestamp", "created_at_utc"].some(
      (key) => comment[key] !== undefined && comment[key] !== null,
    ),
  ).length;

  console.log(
    `  ${name}: ${comments.length} comments, keys ${[...keys].join(", ")}` +
      `\n  ${name}: ${dated} carry a date` +
      (alwaysMissing.length > 0 ? `, null on every one: ${alwaysMissing.join(", ")}` : ""),
  );
}

// ---------------------------------------------------------------- the run

const only = process.argv
  .filter((argument) => argument.startsWith("--only="))
  .map((argument) => argument.slice("--only=".length));

const wanted = (name) => only.length === 0 || only.some((part) => name.includes(part));

console.log("Capturing ScrapeCreators Instagram payloads. This spends credits.");

let commentTargetUrl;

if (wanted("credentials")) {
  await capture(
    "credentials-rejected",
    endpoints.reels,
    { query: keyword },
    { key: "this-key-is-not-real", note: "sent with a deliberately invalid key" },
  );

  await capture(
    "credentials-accepted",
    endpoints.reels,
    {},
    { note: "a working key with no query: refused on the input, not on the key" },
  );
}

/**
 * Instagram's own search, through the public `/popular/{query}` page.
 *
 * This is the endpoint with no middleman, and the first thing to find out
 * about it is whether a post it returns can be placed in time at all.
 */
if (wanted("popular")) {
  const popular = await capture(
    "popular-page-1",
    endpoints.popular,
    { query: keyword },
    { note: "Instagram's own topic page: no Google in the path" },
  );

  describeDates("popular-page-1", postsOf(popular.body));
  describeCaptions("popular-page-1", postsOf(popular.body));
  console.log(`  title ${JSON.stringify(popular.body?.title)}, has_more ${popular.body?.has_more}`);

  const cursor = popular.body?.cursor;

  if (typeof cursor === "string" && cursor !== "") {
    const second = await capture(
      "popular-page-2",
      endpoints.popular,
      { query: keyword, cursor },
      { note: "followed the cursor from popular-page-1.json" },
    );

    const ids = (body) =>
      new Set(
        postsOf(body)
          .map((post) => post?.id)
          .filter(Boolean),
      );
    const one = ids(popular.body);
    const two = ids(second.body);
    console.log(
      `  page 2 holds ${two.size} posts and repeats ` +
        `${[...two].filter((id) => one.has(id)).length} of page 1's ${one.size}`,
    );
  } else {
    failures.push("popular: no cursor came back, so page two was not captured.");
  }
}

/**
 * Google's index of Instagram reels, with a window.
 *
 * Everything the other endpoint lacks is here — a date, engagement counts,
 * comments inside the page — and so is the dependency US-055 refused.
 */
if (wanted("reels")) {
  const reels = await capture(
    "reels-window",
    endpoints.reels,
    { query: keyword, date_posted: "last-month" },
    { note: "Google-indexed, inside a month" },
  );

  describeDates("reels-window", reelsOf(reels.body));
  describeCaptions("reels-window", reelsOf(reels.body));

  const inline = reelsOf(reels.body).flatMap((reel) =>
    Array.isArray(reel?.comments) ? reel.comments : [],
  );
  console.log(
    `  ${reelsOf(reels.body).filter((reel) => (reel?.comments ?? []).length > 0).length}` +
      ` of ${reelsOf(reels.body).length} reels carry comments inside the page` +
      `, ${inline.length} comments in total, at no extra charge`,
  );
  describeComments("reels-window inline", inline);

  /**
   * The busiest reel, not the first one.
   *
   * The first run asked the first reel the search returned, and it had zero
   * comments — so the paid comment page came back empty and billed for it. The
   * YouTube capture beside this one made the identical mistake an hour
   * earlier. `comment_count` is in the answer; read it.
   */
  const busiest = [...reelsOf(reels.body)].sort(
    (a, b) => (b?.comment_count ?? 0) - (a?.comment_count ?? 0),
  )[0];

  if (typeof busiest?.url === "string") {
    commentTargetUrl = busiest.url;
    console.log(`  busiest reel claims ${busiest.comment_count} comments`);
  }

  const next = reels.body?.next_page;
  if (next) {
    const second = await capture(
      "reels-page-2",
      endpoints.reels,
      { query: keyword, date_posted: "last-month", page: next },
      { note: `followed next_page ${JSON.stringify(next)} from reels-window.json` },
    );

    const ids = (body) =>
      new Set(
        reelsOf(body)
          .map((reel) => reel?.id)
          .filter(Boolean),
      );
    const one = ids(reels.body);
    const two = ids(second.body);
    console.log(
      `  page 2 holds ${two.size} reels and repeats ` +
        `${[...two].filter((id) => one.has(id)).length} of page 1's ${one.size}`,
    );
  }
}

/** US-049 fault 1: a search with no window. Question 4. */
if (wanted("no-window")) {
  const open = await capture(
    "reels-no-window",
    endpoints.reels,
    { query: keyword },
    { note: "no date window: US-049 found five years of posts on the other provider" },
  );

  describeDates("reels-no-window", reelsOf(open.body));
}

/** Question 7. */
if (wanted("no-results")) {
  const nothing = await capture(
    "reels-no-results",
    endpoints.reels,
    { query: impossibleKeyword },
    { note: "a phrase that cannot occur; the ledger says what it cost" },
  );

  console.log(
    `  ${reelsOf(nothing.body).length} reels, next_page ` +
      `${JSON.stringify(nothing.body?.next_page)}`,
  );
}

/**
 * Question 8, and US-049 fault 2 by another route.
 *
 * The provider documents pages 1 to 11 and says page 12 or greater answers
 * 400. A refusal here is free and it is the honest shape; an empty page beside
 * a truthy "there is more" is the endless walk US-049 found.
 */
if (wanted("past-last-page")) {
  const past = await capture(
    "reels-page-12",
    endpoints.reels,
    { query: keyword, page: 12 },
    { note: "one page past the documented last one" },
  );

  console.log(
    `  ${reelsOf(past.body).length} reels, next_page ` +
      `${JSON.stringify(past.body?.next_page)}, error ${JSON.stringify(past.body?.error)}`,
  );
}

/**
 * The paid comment endpoint, on a reel the search found. Question 10.
 *
 * `include_replies` is deliberately not sent: the provider says it always
 * costs 15 credits because it makes one request per comment, and this run is
 * measuring the ordinary price.
 */
if (wanted("comments") && commentTargetUrl) {
  const comments = await capture(
    "comments-page-1",
    endpoints.comments,
    { url: commentTargetUrl },
    { note: "the paid comment endpoint, without include_replies" },
  );

  describeComments("comments-page-1", comments.body?.comments ?? []);
} else if (wanted("comments")) {
  failures.push("comments: the reels search returned no URL to ask about.");
}

// ------------------------------------------------------------- the record

let kept = [];
let keptLedger = [];

if (only.length > 0) {
  try {
    const previous = JSON.parse(readFileSync(`${here}manifest.json`, "utf8"));
    const rewritten = new Set(written.map((entry) => entry.file));
    kept = (previous.fixtures ?? []).filter((entry) => !rewritten.has(entry.file));
  } catch {
    // No previous manifest. A full run is the fix.
  }

  try {
    const previous = JSON.parse(readFileSync(`${here}ledger.json`, "utf8"));
    const rewritten = new Set(ledger.map((entry) => entry.call));
    keptLedger = (previous.calls ?? []).filter((entry) => !rewritten.has(entry.call));
  } catch {
    // Same.
  }
}

const fixtures = [...kept, ...written].sort((a, b) => a.file.localeCompare(b.file));

writeFileSync(
  `${here}manifest.json`,
  `${JSON.stringify(
    {
      capturedBy:
        "packages/core/src/sources/providers/scrapecreators/instagram-fixtures/capture.mjs",
      provider:
        "ScrapeCreators, Instagram: the native popular page and the Google-indexed reels search",
      note: "Identity is replaced with stable pseudonyms. Signed CDN addresses are replaced because they expire within hours. Everything else is whole.",
      fixtures,
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  `${here}ledger.json`,
  `${JSON.stringify(
    {
      note: "What each captured call cost, in the provider's own numbers.",
      calls: [...keptLedger, ...ledger],
    },
    null,
    2,
  )}\n`,
);

const spent = ledger.reduce((total, entry) => total + (entry.creditsCharged ?? 0), 0);

console.log(`\nWrote ${written.length} fixtures. manifest.json lists ${fixtures.length}.`);
console.log(`This run was charged ${spent} credits. ledger.json holds the detail.`);

if (failures.length > 0) {
  console.error("\nSome captures did not finish:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
