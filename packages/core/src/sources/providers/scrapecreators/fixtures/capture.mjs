#!/usr/bin/env node
/**
 * Capture the ScrapeCreators payloads the Reddit connector parses.
 *
 * docs/testing.md: a fixture for someone else's API is captured, never
 * written. So this script exists before the parser does, and it stays
 * committed and re-runnable, because the next person to touch the parser needs
 * to be able to ask the provider again.
 *
 * US-025 has five questions the documentation cannot settle, and this script
 * is how each one is answered:
 *
 *   1. Does a search answer at once, or return something to poll? The shape of
 *      the connector follows from this. Bright Data returns a snapshot, which
 *      is why `NextPage` has a `wait` state at all.
 *   2. What is one billable unit, and does the provider report it per call?
 *      The response is documented to carry `credits_charged`. If it does, that
 *      is `unitsConsumed`, measured rather than assumed.
 *   3. What does a refused key say, and with what status?
 *   4. Is a credential probe free? `credits_remaining` before and after
 *      answers it in the provider's own numbers.
 *   5. What is the cursor called and where does it live?
 *
 * Run it with your own key. It spends a few credits, against 100 free:
 *
 *     node packages/core/src/sources/providers/scrapecreators/fixtures/capture.mjs
 *     node packages/core/src/sources/providers/scrapecreators/fixtures/capture.mjs --only=credentials
 *
 * What it writes, into this folder:
 *
 *   <name>.json     one whole response body, with author identity scrubbed
 *   manifest.json   which request produced each file, and when
 *   ledger.json     what each call did to the account's credit balance
 *
 * The payloads are stored whole. Trimming one to the fields we happen to read
 * today is how a parser stops being tested against the fields it ignores.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));

const api = "https://api.scrapecreators.com/v1/reddit";

/**
 * The two endpoints a monitor needs: a keyword search across Reddit, and the
 * recent posts of one subreddit. They are the two discovery modes the Bright
 * Data connector already has, so the pair can be compared like for like.
 *
 * Read from the provider's documentation on 2026-09-05. Every one of them is
 * a claim this run tests, not a fact it trusts.
 */
const endpoints = {
  search: `${api}/search`,
  subreddit: `${api}/subreddit`,
};

/**
 * The query a monitor would generate: somebody describing a problem, not
 * naming a product. The same keyword US-022 ran through Bright Data, so the
 * two providers can be compared on one question.
 */
const keyword = "end to end tests keep breaking";

/** The subreddit US-022 collected, for the same reason. */
const subreddit = "softwaretesting";

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
      "ScrapeCreators is the second provider that fetches Reddit. A new account",
      "gets 100 credits and needs no card. Get a key at https://scrapecreators.com.",
    ].join("\n"),
  );
  process.exit(1);
}

// ------------------------------------------------------------- scrubbing

/**
 * Fields that name a person.
 *
 * They are replaced, not deleted: the parser has to keep seeing a value of the
 * right kind where the provider puts one, and a fixture missing a key agrees
 * with a parser that forgot to read it. The same real value maps to the same
 * pseudonym inside one run, so a payload referring to one author twice still
 * does after scrubbing.
 *
 * The list is deliberately wider than the fields we parse. The Bright Data
 * capture found identity in an avatar URL and in a self-written bio, neither
 * of which the parser reads, and both of which we had no business committing.
 */
const identityFields = new Set([
  "author",
  "author_fullname",
  "author_id",
  "author_name",
  "user",
  "username",
  "name",
  "created_by",
  "mod_note",
]);

/** Identity that arrives as a URL. Scrubbed to a URL, so the shape survives. */
const identityUrlFields = new Set([
  "author_url",
  "user_url",
  "icon_img",
  "snoovatar_img",
  "profile_img",
  "avatar_url",
]);

/** Free text a person wrote about themselves. Not parsed, and not ours to keep. */
const personalTextFields = new Set(["author_flair_text", "public_description", "bio"]);

const scrubbedText = "Scrubbed by capture.mjs. See docs/testing.md.";

/**
 * `name` is Reddit's fullname for a post — `t3_abc123` — and it is also the
 * key an author object uses for a person. Only the second is identity, and
 * scrubbing both would destroy the cursor this script exists to find.
 */
function isPostFullname(value) {
  return /^t[0-9]_[a-z0-9]+$/i.test(value);
}

function createScrubber() {
  const pseudonyms = new Map();
  let count = 0;

  function pseudonym(value) {
    if (!pseudonyms.has(value)) {
      count += 1;
      pseudonyms.set(value, `redditor-${count}`);
    }
    return pseudonyms.get(value);
  }

  function scrub(value) {
    if (Array.isArray(value)) return value.map(scrub);
    if (value === null || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (typeof child === "string" && child !== "") {
          if (key === "name" && isPostFullname(child)) return [key, child];
          if (identityFields.has(key)) return [key, pseudonym(child)];
          if (identityUrlFields.has(key)) {
            return [key, `https://scrubbed.invalid/${pseudonym(child)}`];
          }
          if (personalTextFields.has(key)) return [key, scrubbedText];
        }
        return [key, scrub(child)];
      }),
    );
  }

  return { scrub, replaced: () => pseudonyms.size };
}

// ------------------------------------------------------------------ http

/**
 * One request. Returns the status, the parsed body and the wall-clock time it
 * took, and never throws on a failure status: a rejection is a payload we want
 * captured too. The connector has to tell a user whose key is wrong from a
 * user whose query found nothing, and it can only do that against the real
 * refusal.
 *
 * The elapsed time is evidence for question 1. A search that answers in under
 * a second is a synchronous API; one that returns an id and takes minutes is
 * not.
 */
async function request(url, { key = apiKey } = {}) {
  const startedAt = Date.now();

  const response = await fetch(url, { headers: { "x-api-key": key } });
  const text = await response.text();

  // Not every answer is JSON. Bright Data's invalid key replies with a bare
  // string, and there is no reason to assume this provider is stricter. Keep
  // it as the string it was on the wire: wrapping it in an object of our own
  // invention would make the fixture a record of this script rather than of
  // the provider.
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
 * This is the instrument for question 4. A probe that claims to be free is a
 * claim about somebody's bill, and the only honest way to check it is to read
 * the provider's own balance before and after.
 */
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

// ---------------------------------------------------------------- the run

const only = process.argv
  .filter((argument) => argument.startsWith("--only="))
  .map((argument) => argument.slice("--only=".length));

const wanted = (name) => only.length === 0 || only.some((part) => name.includes(part));

console.log("Capturing ScrapeCreators payloads. This spends credits from your allowance.");

/**
 * The two answers a credential check can get.
 *
 * The rejected one is sent with a key that cannot be real. The accepted one is
 * the cheapest request that still proves the key got past authentication —
 * a search with no `query`, which the provider must refuse on the input rather
 * than on the key. Whether it is free is not assumed here; the ledger says.
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
    {
      note: "a working key with no query: refused on the input, not on the key",
    },
  );
}

/**
 * A keyword search, and then the same search again with the cursor the first
 * one returned.
 *
 * The second call is the one that matters. A cursor we never followed is a
 * cursor we have not tested, and the connector's whole deduplication story
 * rests on following it correctly.
 */
if (wanted("search")) {
  const first = await capture("search-posts", endpoints.search, {
    query: keyword,
    filter: "posts",
    sort: "new",
    timeframe: "month",
  });

  const after = first.body?.after;

  if (typeof after === "string" && after !== "") {
    await capture(
      "search-posts-page-2",
      endpoints.search,
      { query: keyword, filter: "posts", sort: "new", timeframe: "month", after },
      { note: `followed the cursor "${after}" from search-posts.json` },
    );
  } else {
    failures.push(
      "search: the first page reported no cursor, so page two was not captured. " +
        "Read search-posts.json and find what the cursor is really called.",
    );
  }
}

/**
 * The other discovery mode: one subreddit, newest first.
 *
 * No `timeframe`. The first run sent one beside `sort=new` and was refused —
 * "You need to sort by 'top' to provide a timeframe" — which is a rule the
 * documentation does not state. A monitor wants what was said since it last
 * looked, so `new` is the sort we need and the timeframe is the one we cannot
 * have with it. `timeframe-rejected` below keeps that refusal.
 */
if (wanted("subreddit")) {
  await capture("subreddit-posts", endpoints.subreddit, { subreddit, sort: "new" });
}

/**
 * A query the provider refuses on the input rather than on the key.
 *
 * The connector must not tell a user to check their key when the query was the
 * problem, so it needs this refusal in the provider's own words. It is free:
 * the ledger shows nothing charged.
 */
if (wanted("timeframe-rejected")) {
  await capture(
    "timeframe-rejected",
    endpoints.subreddit,
    { subreddit, sort: "new", timeframe: "month" },
    { note: "a timeframe beside sort=new, which the provider refuses" },
  );
}

/**
 * A subreddit that does not exist.
 *
 * This is not a refusal, and that is the point of capturing it. The provider
 * answers 200 with an empty post list and bills a credit for it, so a
 * misspelled subreddit in a monitor costs money every poll and returns
 * nothing. Nothing in the response says the subreddit was the problem.
 */
if (wanted("unknown-subreddit")) {
  await capture(
    "unknown-subreddit",
    endpoints.subreddit,
    { subreddit: "this-subreddit-does-not-exist-intentwatch", sort: "new" },
    { note: "a subreddit that does not exist; answers 200 with no posts, and bills for it" },
  );
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
      capturedBy: "packages/core/src/sources/providers/scrapecreators/fixtures/capture.mjs",
      provider: "ScrapeCreators, Reddit API v1",
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
