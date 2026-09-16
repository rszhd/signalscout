#!/usr/bin/env node
/**
 * Capture the ScrapeCreators payloads a YouTube connector would parse.
 *
 * docs/testing.md: a fixture for someone else's API is captured, never
 * written. So this script exists before the parser does, and it stays
 * committed and re-runnable.
 *
 * US-121 asks these questions, and this script is how each is answered:
 *
 *   1. What is one video on the wire, every field.
 *   2. Is the id YouTube's own eleven-character video id, the one SocialCrawl
 *      returns? Two providers that disagree about identity store and bill the
 *      same video twice.
 *   3. What does one search cost, and how many videos does it return for it?
 *   4. Is the answer in date order, and can it be asked for in date order?
 *      `sortBy` offers `relevance` and `popular` and nothing else, so the
 *      early-stop rule may have nothing to stand on.
 *   5. Does `uploadDate` narrow, and which of its four values are real?
 *   6. What does a search matching nothing return, and is it billed?
 *   7. What is the cursor, and does page two repeat page one?
 *   8. Do comments carry an id, a date and a permalink? US-047 needs the link.
 *   9. What does a refused key say, and is a credential probe free?
 *  10. Is there more text than a title? `includeExtras` claims to add the
 *      description, and a title alone is thin for a classifier.
 *  11. What does the answer mix in beside videos? A parser that takes the
 *      first ten results may be storing three channels.
 *  12. Is a transcript available, and at what price? This is the one platform
 *      here that publishes captions.
 *
 * The TikTok capture beside this one found two traps that apply to the whole
 * provider. An unrecognised parameter is ignored and the call is billed in
 * full, so the trick that makes the Reddit endpoint list its own vocabulary
 * does not work; read https://docs.scrapecreators.com/openapi.json instead, at
 * no cost. And a request refused on its input is free, so a credential probe
 * and a malformed URL both cost nothing.
 *
 * Run it with your own key. It spends about ten credits:
 *
 *     node packages/core/src/sources/providers/scrapecreators/youtube-fixtures/capture.mjs
 *     node .../capture.mjs --only=search
 *
 * What it writes, into this folder: one whole response body per call, with
 * channel identity scrubbed, plus manifest.json and ledger.json. Unlike the
 * TikTok capture, these are stored whole: this endpoint answers in a shape the
 * provider designed rather than in raw YouTube, and a page of twenty videos is
 * 15 KB.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));

const api = "https://api.scrapecreators.com/v1/youtube";

/**
 * The endpoints a monitor would need on this platform.
 *
 * Read from the provider's OpenAPI document on 2026-09-11. Every one of them
 * is a claim this run tests, not a fact it trusts.
 */
const endpoints = {
  search: `${api}/search`,
  comments: `${api}/video/comments`,
  transcript: `${api}/video/transcript`,
};

/** The keyword the SocialCrawl YouTube capture used, so one question is asked. */
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

const apiKey =
  process.env.SCRAPECREATORS_API_KEY || readEnvFile(`${root}.env`).SCRAPECREATORS_API_KEY;

if (!apiKey) {
  console.error(
    [
      "No ScrapeCreators key. Set SCRAPECREATORS_API_KEY in .env, or in the environment.",
      "",
      "The same key fetches Reddit here already. One key serves every platform",
      "behind this provider.",
    ].join("\n"),
  );
  process.exit(1);
}

// ------------------------------------------------------------- scrubbing

/**
 * A channel is a person here, and the field names were read off a real answer
 * before this list was written rather than guessed at. US-049's LinkedIn
 * capture guessed and let real names through.
 *
 * `title` is the trap: it is the video's title on a search result and the
 * channel's name inside `channel`. One key, two meanings, told apart by the
 * container — which is the same shape the TikTok capture met with `desc`.
 */
const identityFields = new Set([
  "handle",
  "channelId",
  "channelHandle",
  "channelTitle",
  "authorChannelId",
  "author_channel_id",
  "authorText",
  "authorName",
  "username",
  "display_name",
]);

/** Containers whose every field names one person. */
const personContainers = new Set(["channel", "author", "owner"]);

/** A picture of a person, or of their video. Replaced, so the shape survives. */
const imageFields = new Set(["thumbnail", "avatar", "avatar_url", "avatarUrl", "authorThumbnail"]);

const scrubbedText = "Scrubbed by capture.mjs. See docs/testing.md.";

/**
 * A YouTube video URL is `watch?v=<id>` and carries no handle, so unlike
 * TikTok's it needs nothing done to it. A channel URL does carry one, and it
 * is scrubbed like any other handle.
 */
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
        if (imageFields.has(key) && typeof child === "string") {
          return [key, "https://scrubbed.invalid/thumbnail.jpg"];
        }

        if (typeof child === "string" && child !== "") {
          if (identityFields.has(key)) return [key, pseudonym(child)];
          if (insidePerson && (key === "title" || key === "name" || key === "id")) {
            return [key, pseudonym(child)];
          }
          if (insidePerson && key === "description") return [key, scrubbedText];

          /**
           * A description is the text this product classifies, so it is kept —
           * and people write channel handles into it. `@testsystemslab` and
           * `@Dropbox` came through the first scrubber, which only looked at
           * strings holding a YouTube URL. The mention keeps its shape and
           * loses the channel; anything else throws away the text we are here
           * to judge.
           */
          if (child.includes("@")) {
            return [
              key,
              child.replace(/@([A-Za-z0-9._-]{2,})/g, (_m, handle) => `@${pseudonym(handle)}`),
            ];
          }
        }

        return [key, scrub(child, insidePerson || personContainers.has(key))];
      }),
    );
  }

  return { scrub, replaced: () => pseudonyms.size, pseudonym };
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

function videosOf(body) {
  return Array.isArray(body?.videos) ? body.videos : [];
}

function describeOrder(name, body) {
  const times = videosOf(body)
    .map((video) => Date.parse(video?.publishedTime ?? ""))
    .filter((value) => Number.isFinite(value));

  if (times.length === 0) {
    console.log(`  ${name}: no dates to read`);
    return;
  }

  const descending = times.every((value, index) => index === 0 || times[index - 1] >= value);
  console.log(
    `  ${name}: ${times.length} dated videos, ` +
      `${new Date(Math.min(...times)).toISOString().slice(0, 10)} to ` +
      `${new Date(Math.max(...times)).toISOString().slice(0, 10)}, ` +
      `${descending ? "newest first" : "NOT in date order"}`,
  );
}

/**
 * What the answer holds beside videos. Question 11.
 *
 * This provider answers with one array per kind rather than one mixed list, so
 * a parser reading `videos` cannot store a channel by accident. Counting them
 * is how that stops being an assumption.
 */
function describeMix(name, body) {
  const kinds = ["videos", "channels", "playlists", "shorts", "shelves", "lives"];
  const counts = kinds
    .map((kind) => `${kind}: ${Array.isArray(body?.[kind]) ? body[kind].length : 0}`)
    .join(", ");
  console.log(`  ${name}: ${counts}`);
}

/**
 * Whether the dates are real or computed from the relative text.
 *
 * `publishedTime` is an ISO timestamp and it looks authoritative. It is not:
 * every video in one answer carries the same time of day, because the provider
 * subtracts "2 weeks ago" from the moment of the call. `publishDate` is the
 * real one, and it arrives only with `includeExtras`. A `since` cut made on
 * the first is wrong by up to a day, every poll.
 */
function describeDates(name, body) {
  const videos = videosOf(body);
  const clocks = new Set(
    videos
      .map((video) => String(video?.publishedTime ?? ""))
      .filter(Boolean)
      .map((stamp) => stamp.slice(11)),
  );

  const exact = videos.filter((video) => typeof video?.publishDate === "string").length;

  console.log(
    `  ${name}: ${clocks.size} distinct times of day across ${videos.length} publishedTime ` +
      `values${clocks.size === 1 ? " — computed from the relative text, not read" : ""}` +
      `, ${exact} carry a publishDate`,
  );
}

function describeText(name, body) {
  const videos = videosOf(body);
  const titles = videos.map((video) => String(video?.title ?? "").length);
  const descriptions = videos
    .map((video) => String(video?.description ?? video?.descriptionSnippet ?? "").length)
    .filter((length) => length > 0);

  const median = (list) =>
    list.length === 0 ? 0 : [...list].sort((a, b) => a - b)[list.length >> 1];

  console.log(
    `  ${name}: median title ${median(titles)} characters, ` +
      `${descriptions.length} of ${videos.length} carry a description` +
      (descriptions.length > 0 ? `, median ${median(descriptions)}` : ""),
  );
}

// ---------------------------------------------------------------- the run

const only = process.argv
  .filter((argument) => argument.startsWith("--only="))
  .map((argument) => argument.slice("--only=".length));

const wanted = (name) => only.length === 0 || only.some((part) => name.includes(part));

console.log("Capturing ScrapeCreators YouTube payloads. This spends credits from your allowance.");

let videoUrl;
let commentTargetUrl;

if (wanted("credentials")) {
  await capture(
    "credentials-rejected",
    endpoints.search,
    { query: keyword },
    { key: "this-key-is-not-real", note: "sent with a deliberately invalid key" },
  );

  await capture(
    "credentials-accepted",
    endpoints.search,
    {},
    { note: "a working key with no query: refused on the input, not on the key" },
  );
}

if (wanted("search")) {
  const videos = await capture(
    "search-videos",
    endpoints.search,
    { query: keyword, type: "videos", uploadDate: "this_month" },
    { note: "videos only, inside a month: the request a monitor would make" },
  );

  describeOrder("search-videos", videos.body);
  describeMix("search-videos", videos.body);
  describeText("search-videos", videos.body);
  describeDates("search-videos", videos.body);

  const first = videosOf(videos.body)[0];
  if (typeof first?.url === "string") videoUrl = first.url;

  const token = videos.body?.continuationToken;

  if (typeof token === "string" && token !== "") {
    const second = await capture(
      "search-videos-page-2",
      endpoints.search,
      { query: keyword, type: "videos", uploadDate: "this_month", continuationToken: token },
      { note: "followed the continuationToken from search-videos.json" },
    );

    describeOrder("search-videos-page-2", second.body);

    const ids = (body) =>
      new Set(
        videosOf(body)
          .map((video) => video?.id)
          .filter(Boolean),
      );
    const one = ids(videos.body);
    const two = ids(second.body);
    console.log(
      `  page 2 holds ${two.size} videos and repeats ` +
        `${[...two].filter((id) => one.has(id)).length} of page 1's ${one.size}`,
    );
  } else {
    failures.push("search: no continuationToken came back, so page two was not captured.");
  }
}

/**
 * The same search with nothing said about `type`. Question 11.
 *
 * A monitor asks for videos. This call is what the answer looks like when
 * nobody says so, which is what a connector would get if the parameter were
 * ever dropped.
 */
if (wanted("mixed")) {
  const mixed = await capture(
    "search-mixed",
    endpoints.search,
    { query: keyword },
    { note: "no type parameter: what the answer holds beside videos" },
  );

  describeMix("search-mixed", mixed.body);
}

/**
 * `includeExtras` claims to add the description and the like and comment
 * counts, and to be slower for it. Question 10.
 *
 * A YouTube search result is a title, and a title is thin for a classifier.
 * If the description arrives here, this connector has more to score than the
 * incumbent does — and the elapsed time in the ledger says what it costs in
 * seconds rather than in credits.
 */
if (wanted("extras")) {
  const extras = await capture(
    "search-with-extras",
    endpoints.search,
    { query: keyword, type: "videos", uploadDate: "this_month", includeExtras: "true" },
    { note: "includeExtras=true: does a description arrive, and how slow is it" },
  );

  describeText("search-with-extras", extras.body);
  describeDates("search-with-extras", extras.body);

  /**
   * The comment target comes from here and not from the plain search, because
   * only this call reports `commentCountInt`. The first run asked the first
   * video the search returned, got an empty page and billed for it — and then
   * three more calls to find out that the video really had no comments rather
   * than that the `order` parameter had broken them. One of twenty videos in
   * this niche has a comment at all.
   */
  const busiest = videosOf(extras.body)
    .filter((video) => (video?.commentCountInt ?? 0) > 0)
    .sort((a, b) => (b.commentCountInt ?? 0) - (a.commentCountInt ?? 0))[0];

  if (busiest?.url) {
    commentTargetUrl = busiest.url;
    console.log(`  busiest video has ${busiest.commentCountInt} comments`);
  } else {
    console.log("  no video in this answer has a single comment");
  }
}

/** The narrowest window. Question 5. */
if (wanted("window")) {
  const today = await capture(
    "search-window-today",
    endpoints.search,
    { query: keyword, type: "videos", uploadDate: "today" },
    { note: "the narrowest window the provider documents" },
  );

  describeOrder("search-window-today", today.body);
}

/** A phrase that cannot occur. Question 6. */
if (wanted("no-results")) {
  const nothing = await capture(
    "search-no-results",
    endpoints.search,
    { query: impossibleKeyword, type: "videos" },
    { note: "a phrase that cannot occur; the ledger says what it cost" },
  );

  describeMix("search-no-results", nothing.body);
}

/**
 * The comments under one video, newest first.
 *
 * `order` takes `top` and `newest`. A monitor wants what was said since it
 * last looked, so `newest` is the one it would ask for — and this provider's
 * Reddit endpoint accepts a `sort` it then answers with zero comments, which
 * is why the count below is printed rather than assumed.
 */
const commentUrl = commentTargetUrl ?? videoUrl;

if (wanted("comments") && commentUrl) {
  const comments = await capture(
    "comments-newest",
    endpoints.comments,
    { url: commentUrl, order: "newest" },
    { note: "newest first, on the first video the search returned" },
  );

  const list = comments.body?.comments;
  if (Array.isArray(list) && list.length > 0) {
    console.log(`  ${list.length} comments`);
    console.log(`  a comment's keys: ${Object.keys(list[0]).join(", ")}`);
  } else {
    console.log("  no comments came back");
  }
} else if (wanted("comments")) {
  failures.push("comments: the search returned no video URL to ask about.");
}

/**
 * The captions of the same video. Question 12.
 *
 * YouTube is the one platform here that publishes them, and a transcript is
 * far more text than a title. The TikTok transcript endpoint returned null on
 * every video asked, so nothing is assumed.
 */
if (wanted("transcript") && videoUrl) {
  const transcript = await capture(
    "transcript",
    endpoints.transcript,
    { url: videoUrl },
    { note: "public captions only" },
  );

  const text = transcript.body?.transcript_only_text ?? transcript.body?.transcript;
  console.log(
    typeof text === "string" && text.length > 0
      ? `  transcript is ${text.length} characters`
      : "  no transcript on this video",
  );
} else if (wanted("transcript")) {
  failures.push("transcript: the search returned no video URL to ask about.");
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
      capturedBy: "packages/core/src/sources/providers/scrapecreators/youtube-fixtures/capture.mjs",
      provider: "ScrapeCreators, YouTube API v1",
      note: "Channel identity is replaced with stable pseudonyms. Everything else is whole.",
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
      note:
        "What each captured call cost, in the provider's own numbers. This is the " +
        "evidence for the billable unit and for whether a credential probe is free.",
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
  console.error("\nThe payloads that did arrive are still written. Fix and re-run.");
  process.exit(1);
}
