#!/usr/bin/env node
/**
 * Capture the SocialCrawl payloads the X connector parses.
 *
 * docs/testing.md: a fixture for someone else's API is captured, never
 * written. So this script exists before the parser does, and it stays
 * committed and re-runnable, because the next person to touch the parser needs
 * to be able to ask the provider again.
 *
 * US-006 reached this provider by elimination, and the elimination is worth
 * recording because it is the reason a third provider exists at all. Bright
 * Data's X posts dataset answers a discovery trigger with `Available types:
 * profile_url, profiles_array`, and ScrapeCreators publishes no X search
 * endpoint. Neither can find a stranger describing a problem, which is the
 * whole product. SocialCrawl documents `/v1/twitter/search/tweets`, so it is
 * the first provider of the three that can.
 *
 * Eight questions the documentation cannot settle, and this script is how each
 * one is answered:
 *
 *   1. What is one post on the wire? Every field the parser will read, and the
 *      ones it will not, because a fixture trimmed to today's parser stops
 *      being evidence tomorrow.
 *   2. What is one billable unit, and does the answer report it? The envelope
 *      is documented to carry `credits_used`. If it does, that is
 *      `unitsConsumed`, measured rather than assumed.
 *   3. Does the cursor work? `data.next_cursor` is documented. A cursor we
 *      never followed is a cursor we have not tested, and deduplication rests
 *      on it.
 *   4. What sort values exist? A monitor wants what was said since it last
 *      looked, so it needs newest-first. The documentation names only
 *      `sort=top`. An invalid value is the cheapest way to make a provider
 *      list the valid ones.
 *   5. Does `since:YYYY-MM-DD` inside the query really narrow the window? It
 *      is an X search operator, not a parameter of this API, so nobody here
 *      has tested that this provider passes it through.
 *   6. What does a refused key say, and with what status? A refusal and an
 *      outage lead to different actions, so the connector needs the real one.
 *   7. Is a credential probe free? `credits_remaining` before and after
 *      answers it in the provider's own numbers.
 *   8. Does a search that finds nothing still bill? ScrapeCreators charges for
 *      a subreddit that does not exist, so this is not a safe assumption.
 *
 * Run it with your own key. A new account gets 100 free credits and needs no
 * card; this run spends about eight of them:
 *
 *     node packages/core/src/sources/providers/socialcrawl/fixtures/capture.mjs
 *     node packages/core/src/sources/providers/socialcrawl/fixtures/capture.mjs --only=search
 *
 * What it writes, into this folder:
 *
 *   <name>.json     one whole response body, with author identity scrubbed
 *   manifest.json   which request produced each file, and when
 *   ledger.json     what each call did to the account's credit balance
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));

const api = "https://www.socialcrawl.dev/v1/twitter";

/**
 * The endpoint a monitor needs, and the one thing the other two providers do
 * not have: keyword discovery across X.
 *
 * Read from the provider's documentation on 2026-09-05. It is a claim this run
 * tests, not a fact it trusts.
 */
const endpoints = {
  search: `${api}/search/tweets`,
  /**
   * The replies under one post, by URL. US-020's X half.
   *
   * One credit and a cursor, the same as a search. The catalogue calls it a
   * `CommentList`, which is the archetype the YouTube and LinkedIn comment
   * endpoints share — so this capture is also the evidence for whether one
   * parser can read all three, or whether the shared name is only a name.
   */
  replies: `${api}/tweet/replies`,
};

/**
 * The query a monitor would generate: somebody describing a problem, not
 * naming a product. The same keyword US-022 ran through Bright Data and
 * US-025 ran through ScrapeCreators, so three providers can be compared on one
 * question.
 */
const keyword = "end to end tests keep breaking";

/**
 * A shorter query, because the long one may match nothing on X.
 *
 * A phrase that works on Reddit is not guaranteed to work on a platform where
 * a post is 280 characters. If the long query returns nothing, this one says
 * whether that was the query or the provider.
 */
const shortKeyword = "flaky tests";

/** A handle every reader can check, for the `from:` operator. */
const handle = "github";

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

const apiKey = process.env.SOCIALCRAWL_API_KEY || readEnvFile(`${root}.env`).SOCIALCRAWL_API_KEY;

if (!apiKey) {
  console.error(
    [
      "No SocialCrawl key. Set SOCIALCRAWL_API_KEY in .env, or in the environment.",
      "",
      "SocialCrawl is the provider that fetches X. A new account gets 100",
      "credits and needs no card. Get a key at https://www.socialcrawl.dev.",
    ].join("\n"),
  );
  process.exit(1);
}

// ------------------------------------------------------------- scrubbing

/**
 * Fields that name a person, wherever they appear.
 *
 * They are replaced, not deleted: the parser has to keep seeing a value of the
 * right kind where the provider puts one, and a fixture missing a key agrees
 * with a parser that forgot to read it. The same real value maps to the same
 * pseudonym inside one run, so a payload referring to one author twice still
 * does after scrubbing.
 *
 * The list is wider than the fields we parse. The Bright Data capture found
 * identity in an avatar URL and in a self-written bio, neither of which the
 * parser reads, and both of which we had no business committing.
 */
const identityFields = new Set([
  "handle",
  "screen_name",
  "username",
  "user_name",
  "author",
  "author_handle",
  "author_name",
  "display_name",
  "full_name",
  "in_reply_to_screen_name",
  "quoted_by",
  "retweeted_by",
]);

/** Identity that arrives as a URL. Scrubbed to a URL, so the shape survives. */
const identityUrlFields = new Set([
  "profile_image_url",
  "profile_image_url_https",
  "profile_banner_url",
  "avatar",
  "avatar_url",
  "profile_url",
  "author_url",
  "user_url",
]);

/** Free text a person wrote about themselves. Not parsed, and not ours to keep. */
const personalTextFields = new Set(["description", "bio", "location", "profile_bio"]);

/**
 * Free text where somebody wrote another person's handle.
 *
 * This is the leak no field rule catches, and it was in this repository for a
 * day before anybody looked: an X post's own `text` is the field the classifier
 * reads, so it cannot be replaced wholesale — and people put "@someone" inside
 * it constantly. The first commit of these fixtures carried real handles of
 * real developers.
 *
 * So the handle is rewritten in place and the sentence around it survives. The
 * fixture still proves what the parser must prove, which is that it reads this
 * text and stores it.
 *
 * The leading boundary keeps an email address whole: rewriting only the half
 * after the `@` mangles text without hiding anybody.
 */
const textFields = new Set(["text", "full_text", "content"]);

function scrubHandlesInText(value, pseudonym) {
  return value.replace(
    /(^|[\s([])@([A-Za-z0-9_]{2,15})\b/g,
    (_, before, handle) => `${before}@${pseudonym(handle)}`,
  );
}

const scrubbedText = "Scrubbed by capture.mjs. See docs/testing.md.";

/**
 * `name` is a display name on a person and something else everywhere else, so
 * it is scrubbed only inside an object that already looks like a person. A
 * blanket rule would rewrite a field the parser reads and turn the fixture
 * into a record of this script.
 */
function looksLikeAPerson(value) {
  return ["handle", "screen_name", "username", "user_name"].some((key) => key in value);
}

/**
 * A post URL on X carries the author's handle: x.com/<handle>/status/<id>.
 *
 * The numeric id is the part the parser reads and it survives untouched. The
 * handle in front of it is identity, and leaving it in would put back exactly
 * what the field scrubbing takes out.
 */
function scrubXUrl(value, pseudonym) {
  const match = value.match(/^(https?:\/\/(?:www\.)?(?:x|twitter)\.com)\/([^/?#]+)(.*)$/i);
  if (!match) return undefined;

  const [, origin, first, rest] = match;
  if (first === "" || first === "i" || first === "search") return undefined;

  return `${origin}/${pseudonym(first)}${rest}`;
}

function createScrubber() {
  const pseudonyms = new Map();
  let count = 0;

  function pseudonym(value) {
    if (!pseudonyms.has(value)) {
      count += 1;
      pseudonyms.set(value, `x-user-${count}`);
    }
    return pseudonyms.get(value);
  }

  function scrub(value, insidePerson = false) {
    if (Array.isArray(value)) return value.map((child) => scrub(child, insidePerson));
    if (value === null || typeof value !== "object") return value;

    const person = insidePerson || looksLikeAPerson(value);

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (typeof child === "string" && child !== "") {
          if (identityFields.has(key)) return [key, pseudonym(child)];
          if (key === "name" && person) return [key, pseudonym(child)];
          if (identityUrlFields.has(key)) {
            return [key, `https://scrubbed.invalid/${pseudonym(child)}`];
          }
          if (personalTextFields.has(key) && person) return [key, scrubbedText];

          const url = scrubXUrl(child, pseudonym);
          if (url) return [key, url];

          if (textFields.has(key) && child.includes("@")) {
            return [key, scrubHandlesInText(child, pseudonym)];
          }
        }

        // A person's fields stay a person's fields one level down: an author
        // object often nests `legacy` or `profile` and puts the identity there.
        return [key, scrub(child, person && typeof child === "object")];
      }),
    );
  }

  return { scrub: (value) => scrub(value), replaced: () => pseudonyms.size };
}

// ------------------------------------------------------------------ http

/**
 * One request. Returns the status, the parsed body and the wall-clock time it
 * took, and never throws on a failure status: a rejection is a payload we want
 * captured too. The connector has to tell a user whose key is wrong from a
 * user whose query found nothing, and it can only do that against the real
 * refusal.
 */
async function request(url, { key = apiKey } = {}) {
  const startedAt = Date.now();

  const response = await fetch(url, { headers: { "x-api-key": key } });
  const text = await response.text();

  // Not every answer is JSON. Bright Data's invalid key replies with a bare
  // string, and there is no reason to assume this provider is stricter. Keep
  // it as the string it was on the wire.
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

/**
 * What the account had left, if the provider says so.
 *
 * This is the instrument for questions 7 and 8. A probe that claims to be free
 * is a claim about somebody's bill, and the only honest way to check it is to
 * read the provider's own balance before and after.
 */
function creditsRemaining(body) {
  const value = body?.credits_remaining;
  return typeof value === "number" ? value : undefined;
}

function creditsUsed(body) {
  const value = body?.credits_used;
  return typeof value === "number" ? value : undefined;
}

function save(name, payload, request_) {
  const scrubber = createScrubber();
  const scrubbed = scrubber.scrub(payload);

  writeFileSync(`${here}${name}.json`, `${JSON.stringify(scrubbed, null, 2)}\n`);

  written.push({
    file: `${name}.json`,
    request: request_,
    capturedAt: new Date().toISOString(),
    identitiesReplaced: scrubber.replaced(),
  });

  console.log(`  wrote ${name}.json (${scrubber.replaced()} identities scrubbed)`);
}

/**
 * Make one call, record what it cost, and write the body as a fixture.
 *
 * Every call goes through here so the ledger cannot miss one. A ledger with a
 * hole in it cannot answer "was the probe billed?", which is an acceptance box
 * on this ticket.
 */
async function capture(name, endpoint, params, options = {}) {
  console.log(`\n${name}`);

  const target = url(endpoint, params);
  const answer = await request(target, options);

  ledger.push({
    call: name,
    httpStatus: answer.status,
    elapsedMs: answer.elapsedMs,
    creditsUsed: creditsUsed(answer.body) ?? null,
    creditsRemaining: creditsRemaining(answer.body) ?? null,
    note: options.note ?? null,
  });

  console.log(
    `  ${answer.status} in ${answer.elapsedMs} ms` +
      `, used ${creditsUsed(answer.body) ?? "(not reported)"}` +
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

/** How many posts an answer carried, whatever the envelope calls the list. */
function itemCount(body) {
  const items = body?.data?.items;
  return Array.isArray(items) ? items.length : undefined;
}

/** The cursor, if the documented field is really there. */
function nextCursor(body) {
  const value = body?.data?.next_cursor;
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** A date `days` before today, as the `since:` operator wants it. */
function isoDay(days) {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- the run

const only = process.argv
  .filter((argument) => argument.startsWith("--only="))
  .map((argument) => argument.slice("--only=".length));

const wanted = (name) => only.length === 0 || only.some((part) => name.includes(part));

console.log("Capturing SocialCrawl payloads. This spends credits from your allowance.");

/**
 * The two answers a credential check can get.
 *
 * The rejected one is sent with a key that cannot be real. The accepted one is
 * the cheapest request that still proves the key got past authentication — a
 * search with no `query`, which the provider must refuse on the input rather
 * than on the key. Whether either is free is not assumed here; the ledger
 * says.
 */
if (wanted("credentials")) {
  await capture(
    "credentials-rejected",
    endpoints.search,
    { query: shortKeyword },
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
 * An invalid sort value.
 *
 * The documentation names `sort=top` and no other. A monitor needs newest
 * first, and the cheapest way to learn the valid values is to send an invalid
 * one and read what the provider lists back. Bright Data answered exactly this
 * question that way for US-005.
 */
if (wanted("sort")) {
  await capture(
    "sort-rejected",
    endpoints.search,
    { query: shortKeyword, sort: "this-is-not-a-sort" },
    { note: "an invalid sort, to make the provider name the valid ones" },
  );
}

/**
 * The search itself, then the same search again with the cursor it returned.
 *
 * The second call is the one that matters. The connector's deduplication story
 * rests on following the cursor correctly, and a documented cursor is not a
 * tested one.
 */
if (wanted("search")) {
  const first = await capture("search-posts", endpoints.search, { query: keyword });

  if (itemCount(first.body) === 0) {
    failures.push(
      `search: "${keyword}" returned no posts. search-short-query.json says whether ` +
        "the query or the provider was the reason.",
    );
  }

  await capture(
    "search-short-query",
    endpoints.search,
    { query: shortKeyword },
    { note: "a shorter query, in case a long phrase matches nothing on X" },
  );

  const cursor = nextCursor(first.body);

  if (cursor) {
    await capture(
      "search-page-2",
      endpoints.search,
      { query: keyword, cursor },
      { note: "followed data.next_cursor from search-posts.json" },
    );
  } else {
    failures.push(
      "search: the first page reported no cursor at data.next_cursor, so page two " +
        "was not captured. Read search-posts.json and find what the cursor is really called.",
    );
  }
}

/**
 * Newest first, which is the sort a monitor needs and not the one the
 * documentation names.
 *
 * The first run made the reason plain. The default sort ranks by engagement
 * over whatever window it likes, so a query about broken tests came back with
 * anime, Bitcoin and a CIA story on page one. The same words with a two-day
 * window came back on topic. That is the Reddit lesson again — US-022 measured
 * keyword noise there — so the connector must ask for recency, and this
 * capture is what says `latest` really gives it.
 */
if (wanted("latest")) {
  await capture(
    "search-latest",
    endpoints.search,
    { query: shortKeyword, sort: "latest" },
    { note: "sort=latest, one of the two values sort-rejected.json listed" },
  );
}

/**
 * The same long phrase, quoted.
 *
 * The provider's documentation says to quote a multi-word phrase when you want
 * relevance rather than engagement ranking. The first run is the argument for
 * testing it: unquoted, `end to end tests keep breaking` returned anime and
 * Bitcoin across three weeks, while a two-word query returned twenty posts
 * that were all on topic. Our query generator writes multi-word phrases, so
 * whether the connector quotes them decides what a monitor sees and what it
 * pays a model to read.
 */
if (wanted("quoted")) {
  await capture(
    "search-quoted-phrase",
    endpoints.search,
    { query: `"${keyword}"`, sort: "latest" },
    { note: "the long phrase in quotes, against search-posts.json unquoted" },
  );
}

/**
 * The bare query again, with nothing beside it.
 *
 * The first run got 200, no posts and no charge for `flaky tests`, and 20
 * posts for the same words with a `since:` operator. One of those is wrong,
 * and a connector built on the wrong one either pays for nothing or finds
 * nothing. Repeating it is the only way to tell a rule from a bad minute.
 */
if (wanted("repeat")) {
  await capture(
    "search-short-query-repeat",
    endpoints.search,
    { query: shortKeyword },
    { note: "the same bare query as search-short-query.json, run again later" },
  );
}

/**
 * The date window, which on this endpoint is an operator inside the query
 * rather than a parameter beside it.
 *
 * A monitor asks for what was said since it last looked. If the operator is
 * passed through, `since` costs nothing extra; if it is treated as ordinary
 * words, every poll pays for the whole history again and the connector has to
 * filter by date itself, the way the ScrapeCreators Reddit connector already
 * does.
 */
if (wanted("since")) {
  await capture(
    "search-since",
    endpoints.search,
    { query: `${shortKeyword} since:${isoDay(2)}` },
    { note: `the since: operator, asking for the last two days (since:${isoDay(2)})` },
  );
}

/**
 * The other discovery mode a monitor can want: one account, not a topic.
 *
 * `from:` is an X operator inside the same query string, so one endpoint
 * covers both modes and the connector needs no second call for channels.
 */
if (wanted("handle")) {
  await capture(
    "search-from-handle",
    endpoints.search,
    { query: `from:${handle}` },
    { note: `the from: operator, for a monitor that watches one account` },
  );
}

/**
 * A query that cannot match anything.
 *
 * This is not a refusal, and that is the point of capturing it. ScrapeCreators
 * answers 200 with an empty list for a subreddit that does not exist and bills
 * a credit for it, so a monitor with a dead query costs money every poll and
 * returns nothing. The ledger says whether this provider does the same.
 */
if (wanted("empty")) {
  await capture(
    "search-no-results",
    endpoints.search,
    { query: '"intentwatch-no-such-phrase-9a3f7c21"' },
    { note: "a phrase that cannot match; does it answer 200 and bill for it?" },
  );
}

/**
 * A query the model actually wrote, run against the real provider.
 *
 * This is the join between two instruments. `capture:queries` records what the
 * prompt writes; this asks whether those words find anybody. US-027 exists
 * because the answer used to be no: the generator wrote Reddit-length phrases
 * and X returned unrelated posts or nothing at all.
 *
 * The query is read from the query plan rather than typed here, so this cannot
 * quietly test a nicer query than the one that ships.
 */
/**
 * The replies under a real post, and the page after them.
 *
 * A post is found first rather than hard-coded: a tweet URL written into this
 * script would rot, and the run has to work a year from now. The search that
 * finds it is captured too, so the fixture says where the post came from.
 *
 * Two calls, and the second is the one that matters. A thread is where a
 * person answers somebody else's post with a problem of their own, so a
 * connector that reads one page and calls a thread finished loses the rest —
 * and a documented cursor is not a tested one.
 */
if (wanted("replies")) {
  const found = await capture(
    "replies-source-search",
    endpoints.search,
    { query: shortKeyword, sort: "top" },
    { note: "finding a post with replies under it, rather than hard-coding one" },
  );

  const posts = found.body?.data?.items ?? [];
  const busiest = posts
    .map((item) => item?.post)
    .filter((post) => post?.url && (post?.engagement?.comments ?? 0) > 2)
    .sort((left, right) => (right.engagement.comments ?? 0) - (left.engagement.comments ?? 0))[0];

  if (!busiest) {
    failures.push(
      "replies: no post in the search had more than two replies, so there was " +
        "nothing to read. Re-run; the search is ranked and its top result moves.",
    );
  } else {
    console.log(`  reading replies under ${busiest.url} (${busiest.engagement.comments} claimed)`);

    const first = await capture(
      "replies-page-1",
      endpoints.replies,
      { url: busiest.url },
      { note: `replies under a post claiming ${busiest.engagement.comments}` },
    );

    if (itemCount(first.body) === 0) {
      failures.push("replies: the endpoint returned nothing for a post that claims replies.");
    }

    const cursor = nextCursor(first.body);

    if (cursor) {
      await capture(
        "replies-page-2",
        endpoints.replies,
        { url: busiest.url, cursor },
        { note: "the cursor followed, to see whether page two is new content" },
      );
    } else {
      console.log("  (no cursor: one page was the whole thread)");
    }
  }
}

if (wanted("generated")) {
  const planPath = new URL("../../../../ai/fixtures/query-plan.json", import.meta.url);

  let generated;
  try {
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    generated = plan?.object?.queries?.x?.[0];
  } catch {
    generated = undefined;
  }

  if (typeof generated === "string" && generated !== "") {
    await capture(
      "search-generated-query",
      endpoints.search,
      { query: generated, sort: "latest" },
      { note: `the first X query in ai/fixtures/query-plan.json: "${generated}"` },
    );
  } else {
    failures.push(
      "generated: ai/fixtures/query-plan.json holds no X query. Run " +
        "`pnpm --filter @intentwatch/core capture:queries` first.",
    );
  }
}

// ------------------------------------------------------------- the record

/**
 * A partial run must not erase the manifest entries for fixtures it did not
 * re-capture. Otherwise `--only` quietly turns the record of where the other
 * payloads came from into a blank, which is the one thing the manifest exists
 * to prevent.
 */
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
      capturedBy: "packages/core/src/sources/providers/socialcrawl/fixtures/capture.mjs",
      provider: "SocialCrawl, X (Twitter) API v1",
      note: "Author identity is replaced with stable pseudonyms. Everything else is whole.",
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

console.log(`\nWrote ${written.length} fixtures. manifest.json lists ${fixtures.length}.`);
console.log("ledger.json holds what each call cost.");

if (failures.length > 0) {
  console.error("\nSome captures did not finish:");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error("\nThe payloads that did arrive are still written. Fix and re-run.");
  process.exit(1);
}
