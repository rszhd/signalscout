#!/usr/bin/env node
/**
 * Capture the ScrapeCreators payloads a TikTok connector would parse.
 *
 * docs/testing.md: a fixture for someone else's API is captured, never
 * written. So this script exists before the parser does, and it stays
 * committed and re-runnable, because the next person to touch the parser needs
 * to be able to ask the provider again.
 *
 * US-119 asks ten questions. This script is how each one is answered:
 *
 *   1. What is one video on the wire, every field.
 *   2. Is the id TikTok's own `aweme_id`, the one SocialCrawl returns? Two
 *      providers that disagree about identity store and bill the same video
 *      twice.
 *   3. What does one search cost, and how many videos does it return for it?
 *   4. Does `sort_by=date-posted` really sort? A parameter that is accepted
 *      and ignored is the shape of BUG-002, so the dates in the answer decide
 *      it and never the status code.
 *   5. Which `date_posted` windows are real, and does the narrowest narrow?
 *   6. What does a search matching nothing return, and is it billed?
 *   7. What is the cursor, and does page two repeat page one?
 *   8. Do comments carry an id, a date and a permalink? US-047 needs the link.
 *   9. What does a refused key say, and is a credential probe free?
 *  10. Is the caption all the text a classifier would get, or is there a
 *      transcript?
 *
 * One thing this provider does *not* do, and it is worth knowing before you
 * pay it: an unrecognised parameter is ignored and the call is billed in full.
 * `?sort=banana` returned a normal page and charged a credit. The trick that
 * made the Reddit endpoint list its own `order` values for free does not work
 * here. The vocabulary is in the provider's OpenAPI document instead, at
 * https://docs.scrapecreators.com/openapi.json, and reading it costs nothing.
 *
 * Run it with your own key. It spends about ten credits:
 *
 *     node packages/core/src/sources/providers/scrapecreators/tiktok-fixtures/capture.mjs
 *     node .../capture.mjs --only=search
 *
 * What it writes, into this folder:
 *
 *   video-whole.json     every field TikTok sends about one video
 *   <name>-digest.json   one search answer reduced to ids, dates and captions
 *   <name>.json          a whole small body: a refusal, a comment page
 *   manifest.json        which request produced each file, and when
 *   ledger.json          what each call did to the account's credit balance
 *
 * Payloads are stored whole wherever they are small. A search page is not:
 * this provider returns raw TikTok, one video is 33 KB scrubbed, and six pages
 * would be 9 MB against 624 KB for the largest fixture folder in the
 * repository. `digestOf` below says what is kept and why.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));

const api = "https://api.scrapecreators.com/v1/tiktok";

/**
 * The endpoints a monitor would need on this platform.
 *
 * Read from the provider's OpenAPI document on 2026-09-11. Every one of them
 * is a claim this run tests, not a fact it trusts.
 */
const endpoints = {
  search: `${api}/search/keyword`,
  comments: `${api}/video/comments`,
  transcript: `${api}/video/transcript`,
};

/**
 * The same two words the SocialCrawl TikTok capture used, so the two providers
 * are asked one question rather than two. `flaky tests` is what somebody in
 * trouble types; `end to end tests keep breaking` is what a product category
 * sounds like, and US-006 measured what a long phrase does to a short-text
 * platform.
 */
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
      "behind this provider, which is why the credential fields live on the",
      "provider and not on a platform.",
    ].join("\n"),
  );
  process.exit(1);
}

// ------------------------------------------------------------- scrubbing

/**
 * This answer is raw TikTok, not a shape the provider invented, so identity
 * arrives in more places than a normalised payload would carry it.
 *
 * The fields are named rather than sniffed for. US-049's LinkedIn capture let
 * real names through a scrubber that decided what a person was by looking at
 * the contents of a field, and the contents did not match. Name the container.
 */
const identityFields = new Set([
  "nickname",
  "unique_id",
  "uid",
  "sec_uid",
  "author",
  "author_user_id",
  "user_id",
  "owner_handle",
  "short_id",
  "ins_id",
  "twitter_id",
  "twitter_name",
  "google_account",
  "youtube_channel_id",
  "youtube_channel_title",
]);

/** Free text a person wrote about themselves. Not parsed, and not ours to keep. */
const personalTextFields = new Set([
  "signature",
  "bio_url",
  "custom_verify",
  "enterprise_verify_reason",
  "account_labels",
]);

/**
 * Containers that are wholly a picture of a person. Replaced as a container,
 * because the shape matters to a parser and the bytes do not.
 */
const avatarContainers = new Set([
  "avatar_thumb",
  "avatar_medium",
  "avatar_larger",
  "avatar_168x168",
  "avatar_300x300",
  "video_icon",
  "cover_url",
]);

/**
 * Every media address TikTok returns is a signed CDN URL that expires within
 * hours, and there are about thirty of them per video. They are four fifths of
 * the bytes here: one untouched search page is 2.6 MB, against 624 KB for the
 * largest fixture folder in the repository.
 *
 * So each `url_list` keeps its key, its type and one entry, and loses the
 * signatures. This is not trimming a payload to the fields we read today,
 * which docs/testing.md forbids and for good reason — every field a parser
 * might read is still here. It is dropping values that stop being evidence a
 * few hours after the capture. The manifest says so, beside the fixtures.
 */
function collapseUrlList(list) {
  return list.length === 0 ? [] : ["https://scrubbed.invalid/media-url-expired.bin"];
}

const scrubbedText = "Scrubbed by capture.mjs. See docs/testing.md.";

/**
 * A TikTok post URL contains the author's handle by construction:
 * `https://www.tiktok.com/@handle/video/7412...`. It is the permalink US-047
 * shows a person, and the video id a parser reads, so it cannot be deleted.
 * The handle inside it is replaced with the same pseudonym the author object
 * got, which keeps the shape exact and keeps the id readable.
 */
function scrubHandleInUrl(value, pseudonym) {
  return value.replace(
    /(@|%40)([A-Za-z0-9._-]+)/g,
    (_match, at, handle) => `${at}${pseudonym(handle)}`,
  );
}

/**
 * A caption and a comment are the text this product classifies, so they are
 * kept — and people write other people's handles into both. `@byeflakes` and
 * `@skincaretheorydaily` came through the first scrubber untouched, because it
 * only looked at strings that contained a TikTok URL.
 *
 * The mention keeps its shape and loses the person. Anything else either
 * throws away the text we are here to judge, or commits a handle we have no
 * business storing.
 */
function scrubMentions(value, pseudonym) {
  return value.replace(/@([A-Za-z0-9._]{2,})/g, (_match, handle) => `@${pseudonym(handle)}`);
}

/**
 * `desc` is the caption on a video and the sharing blurb on a comment, and the
 * second one reads "Everythingclever 00's comment: ...". One key, two
 * meanings, and only the container tells them apart — which is US-049's rule
 * arriving from the other direction: name the container, and know which one
 * you are inside.
 */
const shareContainers = new Set(["share_info"]);

function createScrubber() {
  const pseudonyms = new Map();
  let count = 0;

  function pseudonym(value) {
    if (!pseudonyms.has(value)) {
      count += 1;
      pseudonyms.set(value, `tiktoker-${count}`);
    }
    return pseudonyms.get(value);
  }

  function scrub(value, insideShareInfo = false) {
    if (Array.isArray(value)) return value.map((child) => scrub(child, insideShareInfo));
    if (value === null || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (avatarContainers.has(key)) {
          return [key, { url_list: ["https://scrubbed.invalid/avatar.jpeg"] }];
        }

        if (key === "url_list" && Array.isArray(child)) return [key, collapseUrlList(child)];

        if (typeof child === "string" && child !== "") {
          if (identityFields.has(key)) return [key, pseudonym(child)];
          if (personalTextFields.has(key)) return [key, scrubbedText];
          if (insideShareInfo && (key === "desc" || key === "title")) return [key, scrubbedText];
          if (child.includes("tiktok.com/@")) return [key, scrubHandleInUrl(child, pseudonym)];
          if (child.includes("@")) return [key, scrubMentions(child, pseudonym)];
        }

        return [key, scrub(child, insideShareInfo || shareContainers.has(key))];
      }),
    );
  }

  return { scrub, replaced: () => pseudonyms.size, pseudonym };
}

// ------------------------------------------------------------------ http

/**
 * One request. Returns the status, the parsed body and the wall-clock time it
 * took, and never throws on a failure status: a rejection is a payload we want
 * captured too. A connector has to tell a key that is wrong from a query that
 * found nothing, and it can only do that against the real refusal.
 */
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

  // The manifest records the request, and a comment or transcript request
  // names one video by URL — which carries the author's handle. The first run
  // of this script wrote that handle into manifest.json while the payload
  // beside it was clean. Scrub the request with the same map, after the
  // payload, so one person keeps one pseudonym in both.
  const request = {
    ...request_,
    url: scrubHandleInUrl(request_.url, scrubber.pseudonym),
  };

  written.push({
    file: `${name}.json`,
    request,
    capturedAt: new Date().toISOString(),
    identitiesReplaced: scrubber.replaced(),
    bytes: statSync(path).size,
  });

  console.log(
    `  wrote ${name}.json (${scrubber.replaced()} identities scrubbed, ` +
      `${Math.round(statSync(path).size / 1024)} KiB)`,
  );
}

/**
 * A search answer, reduced to what the question it was asked needs.
 *
 * This is the one place this script departs from "store the payload whole",
 * and the reason is arithmetic. This provider returns raw TikTok: one video is
 * 33 KB after scrubbing, a page of thirty is 1.8 MB, and six captured pages
 * are 9 MB — against 624 KB for the largest fixture folder in this repository.
 *
 * So one whole video is committed, as `video-whole.json`, and it answers
 * question 1 completely: every field TikTok sends, including the ones no
 * parser here reads. The other pages are digests, because the questions they
 * answer are about order, cursor overlap, billing and refusal, and a digest
 * carries all four. The file names say `digest` so that nobody mistakes one
 * for a record of the wire.
 *
 * A connector built on this will want a whole page. Capture one then, in the
 * build ticket, when it is known to be worth 1.8 MB.
 */
function digestOf(body) {
  return {
    success: body?.success ?? null,
    credits_charged: body?.credits_charged ?? null,
    cursor: body?.cursor ?? null,
    has_more: body?.has_more ?? null,
    error: body?.error ?? null,
    message: body?.message ?? null,
    videos: videosOf(body).map((item) => {
      const video = awemeOf(item);
      return {
        aweme_id: video?.aweme_id ?? null,
        create_time: video?.create_time ?? null,
        created_iso:
          typeof video?.create_time === "number"
            ? new Date(video.create_time * 1000).toISOString()
            : null,
        desc: video?.desc ?? null,
        share_url: video?.share_url ?? null,
        author_unique_id: video?.author?.unique_id ?? null,
        comment_count: video?.statistics?.comment_count ?? null,
        play_count: video?.statistics?.play_count ?? null,
      };
    }),
  };
}

/** Make one call, record what it cost, and write the body as a fixture. */
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

  const recorded = {
    method: "GET",
    url: target.replace(apiKey, "<key>"),
    ...(options.note ? { note: options.note } : {}),
  };

  if (options.digest) {
    save(`${name}-digest`, { httpStatus: answer.status, digest: digestOf(answer.body) }, recorded);
  } else {
    save(name, { httpStatus: answer.status, body: answer.body }, recorded);
  }

  return answer;
}

// ------------------------------------------------- reading what came back

/** The videos in a search answer, whatever the wrapper is called. */
function videosOf(body) {
  const list = body?.search_item_list;
  return Array.isArray(list) ? list : [];
}

function awemeOf(item) {
  return item?.aweme_info ?? item;
}

/** Seconds since the epoch, which is what TikTok puts on a video. */
function createdAt(item) {
  const seconds = awemeOf(item)?.create_time;
  return typeof seconds === "number" ? new Date(seconds * 1000) : undefined;
}

function describeOrder(name, body) {
  const dates = videosOf(body).map(createdAt).filter(Boolean);
  if (dates.length === 0) {
    console.log(`  ${name}: no dates to read`);
    return;
  }

  const times = dates.map((date) => date.getTime());
  const descending = times.every((value, index) => index === 0 || times[index - 1] >= value);
  const newest = new Date(Math.max(...times)).toISOString().slice(0, 10);
  const oldest = new Date(Math.min(...times)).toISOString().slice(0, 10);

  console.log(
    `  ${name}: ${dates.length} dated videos, ${oldest} to ${newest}, ` +
      `${descending ? "newest first" : "NOT in date order"}`,
  );
}

function describeCaptions(name, body) {
  const lengths = videosOf(body)
    .map((item) => awemeOf(item)?.desc)
    .filter((text) => typeof text === "string")
    .map((text) => text.length)
    .sort((a, b) => a - b);

  if (lengths.length === 0) {
    console.log(`  ${name}: no captions`);
    return;
  }

  const median = lengths[Math.floor(lengths.length / 2)];
  console.log(
    `  ${name}: caption length ${lengths[0]} to ${lengths[lengths.length - 1]}, median ${median}`,
  );
}

// ---------------------------------------------------------------- the run

const only = process.argv
  .filter((argument) => argument.startsWith("--only="))
  .map((argument) => argument.slice("--only=".length));

const wanted = (name) => only.length === 0 || only.some((part) => name.includes(part));

console.log("Capturing ScrapeCreators TikTok payloads. This spends credits from your allowance.");

/**
 * The two answers a credential check can get.
 *
 * The accepted one is a search with no `query`, which the provider must refuse
 * on the input rather than on the key. Whether either is free is not assumed;
 * the ledger says.
 */
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

/**
 * The search a monitor would run, sorted by date, and then the same search
 * again with the cursor the first one returned.
 *
 * The second call is the one that matters. A cursor we never followed is a
 * cursor we have not tested, and deduplication rests on following it.
 */
let commentTargetUrl;
let transcriptTargetUrl;

if (wanted("search")) {
  const newest = await capture(
    "search-newest",
    endpoints.search,
    { query: keyword, sort_by: "date-posted", date_posted: "this-month" },
    { digest: true, note: "sorted by date, this month: the shape a monitor needs" },
  );

  describeOrder("search-newest", newest.body);
  describeCaptions("search-newest", newest.body);

  // Question 1, answered once and completely: every field TikTok sends about
  // one video, including the ones no parser here reads.
  const whole = videosOf(newest.body)[0];
  if (whole) {
    save(
      "video-whole",
      { note: "one item of search_item_list, whole", item: whole },
      {
        method: "GET",
        url: url(endpoints.search, {
          query: keyword,
          sort_by: "date-posted",
          date_posted: "this-month",
        }),
        note: "the first video of search-newest, kept whole because a page of thirty is 1.8 MB",
      },
    );
  }

  /**
   * The video with the most comments, and not the first one.
   *
   * The first run asked the newest video for its comments and got an empty
   * list, which answers nothing: a video with no comments cannot say whether a
   * comment carries an id, a date or a permalink. Choose the one that can.
   */
  const busiest = videosOf(newest.body)
    .map(awemeOf)
    .filter(Boolean)
    .sort((a, b) => (b?.statistics?.comment_count ?? 0) - (a?.statistics?.comment_count ?? 0))[0];

  const share = busiest?.share_url ?? busiest?.share_info?.share_url;
  if (typeof share === "string") commentTargetUrl = share;

  console.log(
    `  busiest video has ${busiest?.statistics?.comment_count ?? 0} comments` +
      `, caption ${String(busiest?.desc ?? "").length} characters`,
  );

  const cursor = newest.body?.cursor;

  if (cursor !== undefined && cursor !== null && cursor !== 0) {
    const second = await capture(
      "search-newest-page-2",
      endpoints.search,
      { query: keyword, sort_by: "date-posted", date_posted: "this-month", cursor },
      {
        digest: true,
        note: `followed the cursor ${JSON.stringify(cursor)} from search-newest-digest.json`,
      },
    );

    describeOrder("search-newest-page-2", second.body);

    const ids = (body) =>
      new Set(
        videosOf(body)
          .map((item) => awemeOf(item)?.aweme_id)
          .filter(Boolean),
      );
    const one = ids(newest.body);
    const two = ids(second.body);
    const shared = [...two].filter((id) => one.has(id));
    console.log(`  page 2 repeats ${shared.length} of page 1's ${one.size} videos`);
  } else {
    failures.push(
      "search: the first page reported no cursor, so page two was not captured. " +
        "Read search-newest.json and find what the cursor is really called.",
    );
  }

  const relevance = await capture(
    "search-relevance",
    endpoints.search,
    { query: keyword, sort_by: "relevance" },
    { digest: true, note: "the default sort, for comparison with the dated one" },
  );

  describeOrder("search-relevance", relevance.body);
}

/**
 * Relevance ranking inside a recent window.
 *
 * This call was added after the first run, because the first run made the
 * trade-off visible and then failed to test the way out of it. Sorted by date,
 * 4 of 30 captions mentioned software and all four were false — a fish
 * sandwich described as flaky, a flaky croissant. Sorted by relevance, 18 of
 * 30 were real, and the page ran from 2020 to 2026, which is useless to a
 * monitor asking what was said this week.
 *
 * A monitor needs both halves. If the window narrows a relevance-ranked page,
 * this connector is usable and the other combination is a trap. If it does
 * not, TikTok search here cannot serve a monitor at any price.
 */
if (wanted("relevant-window")) {
  const both = await capture(
    "search-relevance-this-month",
    endpoints.search,
    { query: keyword, sort_by: "relevance", date_posted: "this-month" },
    { digest: true, note: "relevance ranking inside the window a monitor would ask for" },
  );

  describeOrder("search-relevance-this-month", both.body);
  describeCaptions("search-relevance-this-month", both.body);

  /**
   * The video with the most caption, for the transcript question.
   *
   * The first two runs asked the newest video and then the busiest one, and
   * both returned `transcript: null`. Neither answers question 10: a video
   * with no speech has no captions to fetch, and a platform's silence is not
   * the same as a provider's. A long caption is the cheapest available signal
   * that somebody is talking.
   */
  const videoPage = /tiktok\.com\/@[^/]+\/video\/\d+/;

  const wordiest = videosOf(both.body)
    .map(awemeOf)
    .filter((video) => videoPage.test(String(video?.share_url ?? "")))
    .sort((a, b) => String(b?.desc ?? "").length - String(a?.desc ?? "").length)[0];

  /**
   * The query string is dropped, and that is a finding rather than tidiness.
   *
   * `share_url` arrives with TikTok's share tracking on it —
   * `?_r=1&u_code=...&share_item_id=...&source=h5_m`. The transcript endpoint
   * refuses that URL in the provider's own words: "We don't want the cdn url,
   * we want the url to the actual TikTok video". It is not a CDN URL; it is
   * the right page with parameters. A connector must strip them before it asks
   * this provider anything about a video, and before it stores the permalink —
   * SocialCrawl returns the same video as a clean address, and two providers
   * that store one video under two URLs have made deduplication harder for no
   * reason.
   *
   * The refusal costs nothing, so this was free to learn and free to get wrong
   * in production for a long time.
   */
  if (wordiest) transcriptTargetUrl = String(wordiest.share_url).split("?")[0];
}

/** A window narrower than the one above. Question 5. */
if (wanted("window")) {
  const yesterday = await capture(
    "search-window-yesterday",
    endpoints.search,
    { query: keyword, sort_by: "date-posted", date_posted: "yesterday" },
    { digest: true, note: "the narrowest window the provider documents" },
  );

  describeOrder("search-window-yesterday", yesterday.body);
}

/**
 * A phrase that cannot occur.
 *
 * SocialCrawl refunds a search that matches nothing on some platforms and
 * bills it in full on others. There is no safe assumption, and a monitor with
 * a bad query pays this every poll.
 */
if (wanted("no-results")) {
  await capture(
    "search-no-results",
    endpoints.search,
    { query: impossibleKeyword, sort_by: "date-posted" },
    { digest: true, note: "a phrase that cannot occur; the ledger says what it cost" },
  );
}

/**
 * An unrecognised parameter.
 *
 * Kept because it is the counterexample to a technique docs/sources.md
 * recommends: on the Reddit endpoint an invalid value makes the provider list
 * its own vocabulary for free, and here it is ignored and billed.
 */
if (wanted("unknown-parameter")) {
  await capture(
    "search-unknown-parameter",
    endpoints.search,
    { query: keyword, sort: "banana" },
    { digest: true, note: "an invented parameter: ignored, answered normally, and billed" },
  );
}

/**
 * The comments under one video found by the search above.
 *
 * Question 8 is whether a comment carries an id, a date and a permalink. A
 * comment with no permalink cannot be shown to a person, which is what stopped
 * US-055 fetching replies at all.
 */
if (wanted("comments") && commentTargetUrl) {
  const comments = await capture(
    "comments-page-1",
    endpoints.comments,
    { url: commentTargetUrl },
    { note: "the first page of comments on the newest video the search returned" },
  );

  const list = comments.body?.comments;
  if (Array.isArray(list) && list.length > 0) {
    const sample = list[0];
    console.log(`  ${list.length} comments, of ${comments.body?.total ?? "(no total)"}`);
    console.log(`  a comment's keys: ${Object.keys(sample).join(", ")}`);
  }
} else if (wanted("comments")) {
  failures.push("comments: the search returned no video URL to ask about.");
}

/**
 * The transcript of the same video.
 *
 * Question 10. A TikTok caption is short, and a classifier reads text. If the
 * spoken words are available and cheap, this platform has more to score than
 * its caption. The AI fallback is deliberately not asked for: it costs ten
 * credits and this run measures what exists, not what can be generated.
 */
const transcriptUrl = transcriptTargetUrl ?? commentTargetUrl;

if (wanted("transcript") && transcriptUrl) {
  const transcript = await capture(
    "transcript",
    endpoints.transcript,
    { url: transcriptUrl },
    { note: "existing captions only; use_ai_as_fallback is not sent" },
  );

  const text = transcript.body?.transcript;
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
    // No previous manifest. A full run is the fix, and the count below says so.
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
      capturedBy: "packages/core/src/sources/providers/scrapecreators/tiktok-fixtures/capture.mjs",
      provider: "ScrapeCreators, TikTok API v1",
      note:
        "Author identity is replaced with stable pseudonyms, and the handle inside a " +
        "post URL is replaced with the same one. Everything else is whole.",
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

const spent = [...ledger].reduce((total, entry) => total + (entry.creditsCharged ?? 0), 0);

console.log(`\nWrote ${written.length} fixtures. manifest.json lists ${fixtures.length}.`);
console.log(`This run was charged ${spent} credits. ledger.json holds the detail.`);

if (failures.length > 0) {
  console.error("\nSome captures did not finish:");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error("\nThe payloads that did arrive are still written. Fix and re-run.");
  process.exit(1);
}
