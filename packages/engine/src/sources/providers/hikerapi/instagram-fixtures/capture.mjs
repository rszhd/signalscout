#!/usr/bin/env node
/**
 * Ask HikerAPI what an Instagram keyword search returns and what it costs.
 *
 * US-160. Instagram has one provider offered and one measured, and the
 * measured one (US-120, ScrapeCreators) finds reels through Google's index,
 * which is the shape the owner dropped for LinkedIn in US-055. HikerAPI is
 * the SaaS behind `instagrapi`, and `/v2/fbsearch/reels` is, in its own
 * words, the surface Instagram's app uses for the Reels tab inside search.
 * Nothing stands between us and the platform, so this is the first candidate
 * that could answer US-160's question with a yes.
 *
 * It is a measurement, not a parser's fixture set. No connector reads what it
 * writes, and none should be written until somebody has read the answers.
 *
 * The questions, in the order they decide things:
 *
 *   1. **Does every post carry a date?** US-120 found ScrapeCreators' native
 *      endpoint returns no `taken_at` at all, and a post with no date cannot
 *      be cut on `since`, cannot be ordered and cannot be shown in the inbox.
 *      HikerAPI returns Instagram's raw JSON, where `taken_at` is an epoch in
 *      seconds. If it is missing here the measurement ends.
 *   2. What is one post on the wire, every field.
 *   3. Is the id the nineteen-digit media id SocialCrawl returns? Two
 *      providers that disagree about identity store the same reel twice.
 *   4. US-049 fault 1: does a search with no window return years of posts?
 *      This endpoint takes no window at all, so the only cut is ours, and the
 *      spread of dates on a page says how much of each page a monitor throws
 *      away.
 *   5. US-049 fault 2: is `has_more` true beside an empty page? Page two is
 *      followed by `reels_max_id` to find out, and to count repeats.
 *   6. US-049 fault 3: which comment fields are null on every comment, and do
 *      comments carry an id, a date and a permalink?
 *   7. What does a search matching nothing return, and is it billed?
 *   8. What does a refused key say, and is a credential probe free?
 *   9. What does a request cost? `/sys/balance` reports `requests` left in
 *      real time and is free to call, so it is read before and after every
 *      call and the difference is the ledger. Every request is priced the
 *      same on this provider, $0.60 per thousand at the time of writing.
 *
 * Run it with your own key. It spends about eight requests:
 *
 *     node packages/engine/src/sources/providers/hikerapi/instagram-fixtures/capture.mjs
 *     node .../capture.mjs --only=search
 *
 * **Read what it writes before you commit it.** The scrubber below was written
 * from Instagram's private-API field names as `instagrapi` documents them,
 * and a field list can only cover what somebody has already seen. Every
 * capture in this repository so far has caught a leak on the first read.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));

const api = "https://api.hikerapi.com";

const endpoints = {
  reels: `${api}/v2/fbsearch/reels`,
  comments: `${api}/v2/media/comments`,
  balance: `${api}/sys/balance`,
};

/** The keyword every Instagram capture here has used, so one question is asked. */
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

const accessKey = process.env.HIKERAPI_ACCESS_KEY || readEnvFile(`${root}.env`).HIKERAPI_ACCESS_KEY;

if (!accessKey) {
  console.error("No HikerAPI key. Set HIKERAPI_ACCESS_KEY in .env.");
  process.exit(1);
}

// ------------------------------------------------------------- scrubbing

/** Instagram's private API names a person with these, wherever they appear. */
const identityFields = new Set(["username", "full_name", "biography"]);

/**
 * `pk` is a primary key under a name that does not say whose. On a person it
 * is identity — US-120's first run let it through — and on a media it is the
 * nineteen-digit id question 3 exists to read, so only the one inside a
 * person container is replaced.
 */
const personKeyFields = new Set(["pk", "id", "fbid_v2", "strong_id__"]);

/** Containers whose every field names one person. */
const personContainers = new Set(["user", "owner", "author", "caption_user"]);

/**
 * Instagram's media addresses are signed CDN URLs with an expiry in the query
 * string. They are most of the bytes and they stop being evidence within
 * hours, so each keeps its key and loses the address.
 */
const mediaFields = new Set([
  "url",
  "profile_pic_url",
  "profile_pic_url_hd",
  "display_url",
  "thumbnail_src",
  "video_url",
  "hd_profile_pic_url_info",
]);

const scrubbedText = "Scrubbed by capture.mjs. See docs/testing.md.";

function createScrubber() {
  const pseudonyms = new Map();
  let count = 0;

  function pseudonym(value) {
    const key = String(value);
    if (!pseudonyms.has(key)) {
      count += 1;
      pseudonyms.set(key, `instagrammer-${count}`);
    }
    return pseudonyms.get(key);
  }

  function scrub(value, insidePerson = false) {
    if (Array.isArray(value)) return value.map((child) => scrub(child, insidePerson));
    if (value === null || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (mediaFields.has(key) && typeof child === "string" && child.startsWith("http")) {
          return [key, "https://scrubbed.invalid/media-url-expired.bin"];
        }

        // A person's key is a number on the wire without `safe_int` and a
        // string with it, and identity either way.
        if (
          insidePerson &&
          personKeyFields.has(key) &&
          (typeof child === "string" || typeof child === "number")
        ) {
          if (child !== "") return [key, pseudonym(child)];
        }

        if (identityFields.has(key) && typeof child === "string" && child !== "") {
          return [key, pseudonym(child)];
        }

        if (typeof child === "string" && child !== "") {
          // A media id is `<media pk>_<owner pk>`. The first half is the id
          // question 3 is about; the second names the owner.
          const mediaId = child.match(/^(\d{15,})_(\d+)$/);
          if (mediaId) return [key, `${mediaId[1]}_${pseudonym(mediaId[2])}`];

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

async function request(url, { key = accessKey } = {}) {
  const startedAt = Date.now();

  const response = await fetch(url, {
    headers: { "x-access-key": key, accept: "application/json" },
  });
  const text = await response.text();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  return { status: response.status, body: parsed, elapsedMs: Date.now() - startedAt };
}

/**
 * `safe_int=true` on every call. A media `pk` is nineteen digits, which is
 * past 2^53, and `JSON.parse` rounds it silently — the dry run of this script
 * against a fake provider deduplicated three distinct reels into one for that
 * reason. The provider offers to send every big integer as a string, and a
 * connector must ask for the same, or the id question is answered wrongly.
 */
function url(endpoint, params) {
  return `${endpoint}?${new URLSearchParams({ ...params, safe_int: "true" })}`;
}

/**
 * Question 9. The balance endpoint is free and `requests` moves in real time,
 * so the number of requests a call cost is the difference around it. A call
 * the provider does not bill — 429, 5xx — is refunded to the counter at once,
 * and shows here as zero.
 */
async function requestsLeft() {
  const answer = await request(endpoints.balance);
  const value = answer.body?.requests;
  return typeof value === "number" ? value : undefined;
}

// ------------------------------------------------------------- capturing

const written = [];
const ledger = [];
const failures = [];

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

  const before = await requestsLeft();
  const target = url(endpoint, params);
  const answer = await request(target, options);
  const after = await requestsLeft();

  const charged = before !== undefined && after !== undefined ? before - after : null;

  ledger.push({
    call: name,
    httpStatus: answer.status,
    elapsedMs: answer.elapsedMs,
    requestsCharged: charged,
    requestsRemaining: after ?? null,
    note: options.note ?? null,
  });

  console.log(
    `  ${answer.status} in ${answer.elapsedMs} ms` +
      `, charged ${charged ?? "(balance not readable)"} request(s)` +
      `, ${after ?? "(not reported)"} left`,
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

/**
 * `/v2/fbsearch/reels` answers with `reels_serp_modules[].clips[]`, and the
 * spec says no more than that about a clip. `instagrapi` reads the media out
 * of each node, so a clip is taken to be `{ media }` or the media itself.
 */
function reelsOf(body) {
  const modules = Array.isArray(body?.reels_serp_modules) ? body.reels_serp_modules : [];
  return modules
    .flatMap((module) => (Array.isArray(module?.clips) ? module.clips : []))
    .map((clip) => clip?.media ?? clip)
    .filter((item) => item && typeof item === "object");
}

function commentsOf(body) {
  const items = body?.response?.items ?? body?.response?.comments;
  return Array.isArray(items) ? items : [];
}

/** A raw `taken_at` is an epoch in seconds; a string would be somebody's format. */
function dateOf(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (typeof value === "number" && value > 0) return value < 1e12 ? value * 1000 : value;
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) return Date.parse(value);
  }
  return undefined;
}

/** Question 1, and it is the one that decides the provider. */
function describeDates(name, items) {
  const times = items.map((item) => dateOf(item, ["taken_at", "device_timestamp"])).filter(Boolean);

  if (times.length === 0) {
    console.log(`  ${name}: ${items.length} items and NOT ONE carries a date`);
    return;
  }

  console.log(
    `  ${name}: ${times.length} of ${items.length} dated, ` +
      `${new Date(Math.min(...times)).toISOString().slice(0, 10)} to ` +
      `${new Date(Math.max(...times)).toISOString().slice(0, 10)}`,
  );
}

/** Question 3: `pk` on a raw media is the nineteen-digit id; `id` is `<pk>_<owner>`. */
function describeIds(name, items) {
  const pks = items.map((item) => String(item?.pk ?? "")).filter(Boolean);
  const nineteen = pks.filter((pk) => /^\d{19}$/.test(pk)).length;
  console.log(
    `  ${name}: ${pks.length} of ${items.length} carry pk, ${nineteen} of them nineteen digits` +
      `, ${items.filter((item) => typeof item?.pk === "string").length} as strings (safe_int held)` +
      `, code on ${items.filter((item) => typeof item?.code === "string").length}`,
  );
}

function describeCaptions(name, items) {
  const lengths = items
    .map((item) => String(item?.caption?.text ?? item?.caption ?? "").length)
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
    dateOf(comment, ["created_at", "created_at_utc"]),
  ).length;
  const withId = comments.filter((comment) => comment?.pk !== undefined).length;

  console.log(
    `  ${name}: ${comments.length} comments, keys ${[...keys].join(", ")}` +
      `\n  ${name}: ${dated} carry a date, ${withId} carry a pk` +
      (alwaysMissing.length > 0 ? `, null on every one: ${alwaysMissing.join(", ")}` : ""),
  );
}

// ---------------------------------------------------------------- the run

const only = process.argv
  .filter((argument) => argument.startsWith("--only="))
  .map((argument) => argument.slice("--only=".length));

const wanted = (name) => only.length === 0 || only.some((part) => name.includes(part));

console.log("Capturing HikerAPI Instagram payloads. This spends requests.");

const opening = await requestsLeft();
console.log(`${opening ?? "(balance not readable)"} requests on the account before the run.`);

let commentTarget;

/** Question 8. A refused key, then a working key with no query. */
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
 * Instagram's own reels search. Questions 1 to 5.
 *
 * There is no date parameter to send, so the first page is the whole answer
 * to "how wide is a page", and page two says whether the cursor walks.
 */
if (wanted("search")) {
  const first = await capture(
    "search-page-1",
    endpoints.reels,
    { query: keyword },
    { note: "Instagram's own Reels-tab search: no Google in the path, no window to send" },
  );

  const reels = reelsOf(first.body);
  describeDates("search-page-1", reels);
  describeIds("search-page-1", reels);
  describeCaptions("search-page-1", reels);
  console.log(
    `  has_more ${JSON.stringify(first.body?.has_more)}, ` +
      `reels_max_id ${JSON.stringify(first.body?.reels_max_id)}, ` +
      `page_index ${JSON.stringify(first.body?.page_index)}`,
  );

  /**
   * The busiest reel, not the first one. US-120 and US-121 each asked the
   * first reel for its comments, it had none, and the page was billed empty.
   * `comment_count` is in the answer; read it.
   */
  const busiest = [...reels].sort((a, b) => (b?.comment_count ?? 0) - (a?.comment_count ?? 0))[0];
  if (busiest?.pk !== undefined) {
    commentTarget = String(busiest.pk);
    console.log(`  busiest reel claims ${busiest.comment_count} comments`);
  }

  const cursor = first.body?.reels_max_id;
  if (typeof cursor === "string" && cursor !== "") {
    const second = await capture(
      "search-page-2",
      endpoints.reels,
      {
        query: keyword,
        reels_max_id: cursor,
        ...(first.body?.rank_token ? { rank_token: first.body.rank_token } : {}),
      },
      { note: "followed reels_max_id and rank_token from search-page-1.json" },
    );

    const ids = (items) => new Set(items.map((item) => String(item?.pk ?? "")).filter(Boolean));
    const one = ids(reels);
    const two = ids(reelsOf(second.body));
    describeDates("search-page-2", reelsOf(second.body));
    console.log(
      `  page 2 holds ${two.size} reels and repeats ${[...two].filter((id) => one.has(id)).length}` +
        ` of page 1's ${one.size}; has_more ${JSON.stringify(second.body?.has_more)}`,
    );
  } else {
    failures.push("search: no reels_max_id came back, so page two was not captured.");
  }
}

/** Question 7. */
if (wanted("no-results")) {
  const nothing = await capture(
    "search-no-results",
    endpoints.reels,
    { query: impossibleKeyword },
    { note: "a phrase that cannot occur; the ledger says what it cost" },
  );

  console.log(
    `  ${reelsOf(nothing.body).length} reels, has_more ${JSON.stringify(nothing.body?.has_more)}` +
      `, reels_max_id ${JSON.stringify(nothing.body?.reels_max_id)}`,
  );
}

/** Question 6, on a reel the search found. The spec says one request is fifteen comments. */
if (wanted("comments") && commentTarget) {
  const comments = await capture(
    "comments-page-1",
    endpoints.comments,
    { id: commentTarget },
    { note: "one page of comments on the busiest reel the search returned" },
  );

  describeComments("comments-page-1", commentsOf(comments.body));
  console.log(`  next_page_id ${JSON.stringify(comments.body?.next_page_id)}`);
} else if (wanted("comments")) {
  failures.push("comments: the search returned no pk to ask about.");
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
      capturedBy: "packages/engine/src/sources/providers/hikerapi/instagram-fixtures/capture.mjs",
      provider: "HikerAPI, Instagram: the native Reels-tab search and one page of comments",
      note: "Identity is replaced with stable pseudonyms. Signed CDN addresses are replaced because they expire within hours. Everything else is whole.",
      fixtures,
    },
    null,
    2,
  )}\n`,
);

const closing = await requestsLeft();

writeFileSync(
  `${here}ledger.json`,
  `${JSON.stringify(
    {
      note: "What each captured call cost, as the difference in /sys/balance requests around it. Every request is priced the same; the price is on the provider's pricing page, not in the API.",
      requestsBeforeRun: opening ?? null,
      requestsAfterRun: closing ?? null,
      calls: [...keptLedger, ...ledger],
    },
    null,
    2,
  )}\n`,
);

const spent = ledger.reduce((total, entry) => total + (entry.requestsCharged ?? 0), 0);

console.log(`\nWrote ${written.length} fixtures. manifest.json lists ${fixtures.length}.`);
console.log(`This run was charged ${spent} requests. ledger.json holds the detail.`);

if (failures.length > 0) {
  console.error("\nSome captures did not finish:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
