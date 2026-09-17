#!/usr/bin/env node
/**
 * Ask the "Real-Time LinkedIn Scraper API" on RapidAPI what a LinkedIn
 * keyword search returns and what it costs.
 *
 * US-122. LinkedIn has one provider offered, and every other route found on
 * 2026-09-17 fails one test: ScrapeCreators reads Google's index (dropped in
 * US-055), SocialCrawl is off on price, Crustdata sells its live search to
 * enterprise on request, Unipile runs through the person's own LinkedIn
 * account, and Piloterr's post search answers 403 the way its routes that do
 * not exist answer 403. This API is the one left that documents a keyword
 * search of posts with LinkedIn's own facets — its tutorial mirrors the
 * `linkedin.com/search/results/content/` URL field for field — behind a key a
 * person can paste.
 *
 * It is a measurement, not a parser's fixture set. No connector reads what it
 * writes, and none should be written until somebody has read the answers.
 *
 * The questions, in the order they decide things:
 *
 *   1. **Does it find a post by keyword from a stranger?** The documentation
 *      says yes. One page for a phrase says whether the posts are about the
 *      phrase.
 *   2. **Does `sortBy: "date_posted"` really order by date?** Apify's actor
 *      selects recent posts and does not order them; SocialCrawl orders by
 *      relevance. A page that is monotonic in time lets a connector stop
 *      paging when a page falls before `since`.
 *   3. Does `datePosted: "past-24h"` narrow the answer, and is every post on
 *      that page really under a day old?
 *   4. What is one post on the wire, every field, and what is the date field
 *      called.
 *   5. **Is the id the activity id?** Apify and SocialCrawl both return the
 *      nineteen-digit activity id, so a post collected through either is not
 *      stored again. A provider that returns a URN instead must carry the
 *      same number inside it.
 *   6. What does a search matching nothing return, and is it billed? The
 *      plan says a failed request costs no credit; an empty success is not a
 *      failed request.
 *   7. What does a refused key say, and is that free?
 *   8. What does a call cost, in the provider's own numbers? RapidAPI puts
 *      the remaining quota in `x-ratelimit-*` response headers, so they are
 *      the ledger. The tutorial prices every call at one credit; the
 *      question is how many posts one credit buys.
 *   9. Are comments in the answer? They are not asked for separately here;
 *      the question is only whether a post carries them or a count.
 *
 * Run it with your own key. It spends five requests on a plan whose free
 * tier is fifty a month:
 *
 *     node packages/engine/src/sources/providers/rapidapi/linkedin-fixtures/capture.mjs
 *     node .../capture.mjs --only=search
 *
 * **Read what it writes before you commit it.** The scrubber is US-056's,
 * carried over field for field, and that one leaked three things on its first
 * run. This provider will name a person under fields nobody has seen yet.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));

/** One API on RapidAPI is one host; the key is RapidAPI's and serves them all. */
const host = "linkedin-data-api.p.rapidapi.com";
const api = `https://${host}`;

/** The keyword every LinkedIn capture here has used, so one question is asked. */
const keyword = "flaky tests";

/** A phrase that cannot occur. Question 6 is what this costs. */
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

const apiKey = process.env.RAPIDAPI_API_KEY || readEnvFile(`${root}.env`).RAPIDAPI_API_KEY;

if (!apiKey) {
  console.error("No RapidAPI key. Set RAPIDAPI_API_KEY in .env.");
  process.exit(1);
}

// ------------------------------------------------------------- scrubbing

/**
 * The lists US-056 wrote for HarvestAPI, whole, plus the camel and snake
 * spellings a second provider is likely to use. A field list can only cover
 * what somebody has already seen, so the member-id and URL rules below match
 * the *shape* of identity and not only its name.
 */
const identityFields = new Set([
  "author",
  "authorName",
  "author_name",
  "authorHeadline",
  "name",
  "fullName",
  "full_name",
  "firstName",
  "first_name",
  "lastName",
  "last_name",
  "publicIdentifier",
  "username",
  "handle",
  "urn",
]);

const identityUrlFields = new Set([
  "authorUrl",
  "author_url",
  "profileUrl",
  "profile_url",
  "publicProfileUrl",
  "picture",
  "pictureUrl",
  "profilePicture",
  "profile_picture",
  "avatar",
  "avatarUrl",
  "logo",
  "logoUrl",
  "companyUrl",
  "url",
]);

const personalTextFields = new Set([
  "headline",
  "position",
  "occupation",
  "jobTitle",
  "bio",
  "summary",
  "about",
  "location",
  "description",
  "info",
]);

const personContainers = new Set([
  "author",
  "actor",
  "user",
  "member",
  "profile",
  "poster",
  "company",
  "organization",
  "authorCompany",
]);

const scrubbedText = "Scrubbed by capture.mjs. See docs/testing.md.";

/** A profile photo is identity, and it arrives on LinkedIn's media host. */
function isMediaUrl(value) {
  return /^https?:\/\/[^/]*licdn\.com\//i.test(value);
}

/**
 * A LinkedIn URL carries identity in its path, and the post URL is the worst
 * case: `linkedin.com/posts/<person-slug>_<title-slug>-activity-<id>-<hash>`
 * puts somebody's name in front of the one part a parser reads. The slug is
 * cut at the **first** underscore, because the slugs use hyphens and cutting
 * at the last one destroyed an activity id in US-054's first run.
 */
function scrubLinkedInUrl(value, pseudonym) {
  const match = value.match(
    /^(https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com)\/([^/?#]+)\/([^?#]*)(.*)$/i,
  );
  if (!match) return undefined;

  const [, origin, section, rest, tail] = match;

  if (section === "posts" || section === "pulse") {
    const cut = rest.indexOf("_");
    const activity = cut === -1 ? "" : rest.slice(cut);
    const slug = cut === -1 ? rest : rest.slice(0, cut);
    return `${origin}/${section}/${pseudonym(slug)}${activity}${tail}`;
  }

  if (["in", "company", "school", "showcase"].includes(section)) {
    const [first, ...after] = rest.split("/");
    return `${origin}/${section}/${pseudonym(first)}${after.length ? `/${after.join("/")}` : ""}${tail}`;
  }

  return undefined;
}

/**
 * `urn:li:person:ABC123` names one person and `urn:li:activity:123` names one
 * post. Only the first is identity; the second is the id question 5 exists to
 * answer, and destroying it would answer it wrongly.
 */
function scrubUrn(value, pseudonym) {
  const match = value.match(/^urn:li:(person|member|fsd_profile|organization|company):(.+)$/i);
  if (!match) return undefined;

  const [, kind, id] = match;
  return `urn:li:${kind}:${pseudonym(id)}`;
}

/** A LinkedIn member id, wherever it appears in a string. */
function scrubMemberIds(value, pseudonym) {
  return value.replace(/ACoAA[A-Za-z0-9_-]{15,}/g, (id) => pseudonym(id));
}

function createScrubber() {
  const pseudonyms = new Map();
  let count = 0;

  function pseudonym(value) {
    if (!pseudonyms.has(value)) {
      count += 1;
      pseudonyms.set(value, `li-user-${count}`);
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
          // `urn` on a post is the activity urn and stays; on a person it is
          // identity. `url` on a post is the post's own address and goes
          // through the LinkedIn URL rule; on a person it is a profile.
          if (identityFields.has(key) && (childIsPerson || (key !== "name" && key !== "urn"))) {
            return [key, pseudonym(child)];
          }
          if (identityUrlFields.has(key) && (childIsPerson || key !== "url")) {
            return [key, `https://scrubbed.invalid/${pseudonym(child)}`];
          }
          if (personalTextFields.has(key) && childIsPerson) return [key, scrubbedText];
          if (childIsPerson && isMediaUrl(child)) {
            return [key, `https://scrubbed.invalid/${pseudonym(child)}`];
          }

          const cleaned = scrubMemberIds(child, pseudonym);

          const url = scrubLinkedInUrl(cleaned, pseudonym);
          if (url) return [key, url];

          const urn = scrubUrn(cleaned, pseudonym);
          if (urn) return [key, urn];

          if (cleaned !== child) return [key, cleaned];
        }

        return [key, scrub(child, childIsPerson && typeof child === "object")];
      }),
    );
  }

  return { scrub: (value) => scrub(value), replaced: () => pseudonyms.size };
}

// ------------------------------------------------------------------ http

async function call(path, body, { key = apiKey } = {}) {
  const startedAt = Date.now();

  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers: {
      "x-rapidapi-key": key,
      "x-rapidapi-host": host,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  /** Question 8: RapidAPI's quota headers are the only bill a call reports. */
  const quota = {};
  for (const [name, value] of response.headers) {
    if (name.startsWith("x-ratelimit-")) quota[name] = value;
  }

  return { status: response.status, body: parsed, quota, elapsedMs: Date.now() - startedAt };
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

async function capture(name, path, body, options = {}) {
  console.log(`\n${name}`);

  const answer = await call(path, body, options);

  ledger.push({
    call: name,
    httpStatus: answer.status,
    elapsedMs: answer.elapsedMs,
    quota: answer.quota,
    note: options.note ?? null,
  });

  const remaining = Object.entries(answer.quota)
    .filter(([header]) => header.endsWith("-remaining"))
    .map(
      ([header, value]) =>
        `${header.replace("x-ratelimit-", "").replace("-remaining", "")} ${value}`,
    )
    .join(", ");

  console.log(
    `  ${answer.status} in ${answer.elapsedMs} ms, left: ${remaining || "(no quota headers)"}`,
  );

  save(
    name,
    { httpStatus: answer.status, body: answer.body },
    { method: "POST", url: `${api}${path}`, body, ...(options.note ? { note: options.note } : {}) },
  );

  return answer;
}

// ------------------------------------------------- reading what came back

/** The tutorial does not say where the list lives; every likely place is read. */
function postsOf(body) {
  const candidates = [
    body?.data?.items,
    body?.data?.posts,
    body?.data,
    body?.items,
    body?.posts,
    body,
  ];
  return candidates.find((value) => Array.isArray(value)) ?? [];
}

function dateOf(post) {
  for (const key of [
    "postedDateTimestamp",
    "postedAtTimestamp",
    "postedAt",
    "postedDate",
    "posted_at",
    "date",
    "createdAt",
  ]) {
    const value = post?.[key];
    if (typeof value === "number" && value > 0) return value < 1e12 ? value * 1000 : value;
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) return Date.parse(value);
  }
  return undefined;
}

/** Questions 2 and 3. */
function describeDates(name, posts) {
  const times = posts.map(dateOf).filter(Boolean);

  if (times.length === 0) {
    console.log(
      `  ${name}: ${posts.length} posts and NOT ONE carries a date this script recognises`,
    );
    console.log(`  ${name}: keys on the first post: ${Object.keys(posts[0] ?? {}).join(", ")}`);
    return;
  }

  const now = Date.now();
  const hours = (time) => Math.round((now - time) / 36e5);
  const ordered = times.every((time, index) => index === 0 || time <= times[index - 1]);

  console.log(
    `  ${name}: ${times.length} of ${posts.length} dated, ` +
      `${hours(Math.max(...times))} to ${hours(Math.min(...times))} hours old` +
      `, ${ordered ? "newest first, monotonic" : "NOT ordered by date"}`,
  );
}

/** Question 5. */
function describeIds(name, posts) {
  const text = JSON.stringify(posts);
  const activities = new Set(text.match(/\b\d{19}\b/g) ?? []);
  const urns = posts.filter((post) => typeof post?.urn === "string").length;
  console.log(
    `  ${name}: ${activities.size} distinct nineteen-digit ids across ${posts.length} posts, ` +
      `urn on ${urns}, id on ${posts.filter((post) => post?.id !== undefined).length}`,
  );
}

function describeText(name, posts) {
  const lengths = posts
    .map((post) => String(post?.text ?? post?.content ?? "").length)
    .filter((length) => length > 0)
    .sort((a, b) => a - b);

  console.log(
    lengths.length === 0
      ? `  ${name}: no post text under text or content`
      : `  ${name}: text ${lengths[0]} to ${lengths[lengths.length - 1]}, median ${lengths[lengths.length >> 1]}`,
  );
}

/** Question 9. */
function describeComments(name, posts) {
  const withList = posts.filter(
    (post) => Array.isArray(post?.comments) && post.comments.length > 0,
  ).length;
  const withCount = posts.filter((post) =>
    ["commentsCount", "comments_count", "totalComments", "commentCount"].some(
      (key) => typeof post?.[key] === "number",
    ),
  ).length;
  console.log(`  ${name}: comments listed on ${withList} posts, a count on ${withCount}`);
}

// ---------------------------------------------------------------- the run

const only = process.argv
  .filter((argument) => argument.startsWith("--only="))
  .map((argument) => argument.slice("--only=".length));

const wanted = (name) => only.length === 0 || only.some((part) => name.includes(part));

console.log("Capturing RapidAPI LinkedIn payloads. This spends requests.");

/** Question 7. */
if (wanted("credentials")) {
  await capture(
    "credentials-rejected",
    "/search-posts",
    { keyword, sortBy: "date_posted" },
    { key: "this-key-is-not-real", note: "sent with a deliberately invalid key" },
  );
}

/** Questions 1, 2, 4, 5, 9: the search, newest first. */
if (wanted("search")) {
  const byDate = await capture(
    "search-by-date",
    "/search-posts",
    { keyword, sortBy: "date_posted", page: 1 },
    { note: "LinkedIn's own content search, sorted by date_posted, no window" },
  );

  const posts = postsOf(byDate.body);
  console.log(
    `  ${posts.length} posts; top-level keys ${Object.keys(byDate.body ?? {}).join(", ")}`,
  );
  describeDates("search-by-date", posts);
  describeIds("search-by-date", posts);
  describeText("search-by-date", posts);
  describeComments("search-by-date", posts);
}

/** Question 3: the narrowest window. */
if (wanted("window")) {
  const day = await capture(
    "search-past-24h",
    "/search-posts",
    { keyword, sortBy: "date_posted", datePosted: "past-24h", page: 1 },
    { note: "the narrowest window the tutorial lists" },
  );

  const posts = postsOf(day.body);
  describeDates("search-past-24h", posts);
  const stale = posts.map(dateOf).filter((time) => time && Date.now() - time > 26 * 36e5).length;
  console.log(`  ${stale} of ${posts.length} are older than the window claims`);
}

/** Question 6. */
if (wanted("no-results")) {
  const nothing = await capture(
    "search-no-results",
    "/search-posts",
    { keyword: impossibleKeyword, sortBy: "date_posted", page: 1 },
    { note: "a phrase that cannot occur; the quota headers say what it cost" },
  );

  console.log(
    `  ${postsOf(nothing.body).length} posts, success ${JSON.stringify(nothing.body?.success)}`,
  );
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
      capturedBy: "packages/engine/src/sources/providers/rapidapi/linkedin-fixtures/capture.mjs",
      provider: `RapidAPI, ${host}: LinkedIn's own content search by keyword`,
      note: "Identity is replaced with stable pseudonyms; activity ids and post URLs keep their id. Everything else is whole.",
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
      note: "What each captured call cost, from RapidAPI's x-ratelimit-* headers. One credit a call on this plan; a failed call is not charged.",
      calls: [...keptLedger, ...ledger],
    },
    null,
    2,
  )}\n`,
);

console.log(`\nWrote ${written.length} fixtures. manifest.json lists ${fixtures.length}.`);
console.log("ledger.json holds what each call did to the quota.");

if (failures.length > 0) {
  console.error("\nSome captures did not finish:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
