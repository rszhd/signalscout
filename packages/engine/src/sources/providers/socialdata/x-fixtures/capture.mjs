#!/usr/bin/env node
/**
 * Ask SocialData what an X search returns and what it costs.
 *
 * US-060, and the first candidate since US-006 that can search X at all.
 * Bright Data's X dataset discovers by profile only and ScrapeCreators
 * publishes no X search, so this product has polled X through one account at
 * one company since the day it could poll X.
 *
 * It is a measurement, not a parser's fixture set. No connector reads what it
 * writes yet, and none should be written until somebody has read the answers.
 *
 * **The MCP server is deliberately not used.** A connector calls the REST API,
 * and a fixture has to be the wire format that connector will parse; an answer
 * from an MCP would be evidence about the MCP. Same rule as every fixture
 * here.
 *
 * Eight questions the documentation cannot settle:
 *
 *   1. What is one tweet on the wire? Every field, including the ones a parser
 *      would not read today.
 *   2. **Is the id the tweet id?** SocialCrawl returns `2066207953355432118`
 *      and builds `x.com/<handle>/status/<id>`. If `id_str` is the same
 *      number, the two providers deduplicate against each other and `posts`
 *      needs nothing new.
 *   3. **Is there a URL, or must one be built?** The documented tweet has
 *      none. US-047: a URL format we invent is evidence about our own string
 *      building and none about the platform, so this script prints one for a
 *      person to open.
 *   4. **Does `type=Latest` really order by date?** Every X connector wants
 *      newest first, and it is what makes an early stop on `since` legitimate.
 *   5. **Does `since_time:` narrow the answer?** No X connector here can push
 *      a window to the provider; `socialcrawl/x.ts` pays for everything older
 *      than `since` and throws it away. A parameter accepted and ignored is
 *      the shape of BUG-002.
 *   6. How many tweets does a page hold, and what does the call cost? The
 *      price is per result, so the two questions are one.
 *   7. **What does a search matching nothing cost?** SocialCrawl refunds an
 *      empty X search, measured twice. The documentation says this one charges
 *      $0.0002 beyond three requests a minute.
 *   8. What does a refused key say, and with what status? 401 and 402 are
 *      different answers — a wrong key and an empty balance need different
 *      actions.
 *
 * Run it with your own key:
 *
 *     node packages/core/src/sources/providers/socialdata/x-fixtures/capture.mjs
 *
 * **This account's balance is read before and after.** The provider bills per
 * result at $0.0002, so about four calls of twenty tweets is under two cents —
 * but the balance is a hard stop here: the API answers 402 when it runs out.
 *
 * What it writes, into this folder:
 *
 *   <name>.json     one whole response body, with author identity scrubbed
 *   manifest.json   which request produced each file, and when
 *   ledger.json     what the account balance did across the run
 *   findings.json   the answers to the questions above, computed
 *
 * **Read the fixtures before committing them.** Three LinkedIn captures in
 * three days had scrubbers that were wrong in ways only reading the output
 * showed: a leaked headline, three raw member ids, and every post URL
 * destroyed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));

const api = "https://api.socialdata.tools";

/** The query US-006 polled live, so the two X providers answer one question. */
const keyword = "flaky tests";

/** A phrase that cannot occur, for question 7. */
const impossible = "kumquat velocipede telemetry brunch";

/** How far back the windowed search asks, for question 5. */
const windowHours = 24;

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

const apiKey = process.env.SOCIALDATA_API_KEY || readEnvFile(`${root}.env`).SOCIALDATA_API_KEY;

if (!apiKey) {
  console.error(
    [
      "No SocialData key. Set SOCIALDATA_API_KEY in .env, or in the environment.",
      "",
      "**Quote the value.** A key here can contain a pipe character, which the",
      "shell reads as a command pipeline: SOCIALDATA_API_KEY='...'",
    ].join("\n"),
  );
  process.exit(1);
}

// ------------------------------------------------------------- scrubbing

/**
 * Fields that name a person on X.
 *
 * They are replaced, not deleted: the parser has to keep seeing a value of the
 * right kind where the provider puts one, and a fixture missing a key agrees
 * with a parser that forgot to read it.
 *
 * `screen_name` is pseudonymised rather than removed **because the post URL is
 * built from it**. A fixture with no handle could not show the format the
 * connector would produce, which is question 3.
 */
const identityFields = new Set([
  "screen_name",
  "name",
  "user_id_str",
  "user_id",
  "in_reply_to_screen_name",
  "in_reply_to_user_id",
  "in_reply_to_user_id_str",
  "quoted_status_user_id_str",
]);

/** Identity that arrives as a URL. Scrubbed to a URL, so the shape survives. */
const identityUrlFields = new Set([
  "profile_image_url_https",
  "profile_banner_url",
  "profile_image_url",
]);

/** Free text a person wrote about themselves. Not parsed, and not ours to keep. */
const personalTextFields = new Set(["description", "location", "url"]);

const scrubbedText = "Scrubbed by capture.mjs. See docs/testing.md.";

/**
 * A key whose value is a whole person.
 *
 * Naming the container rather than sniffing its fields is what US-028 arrived
 * at after committing real names once.
 */
const personContainers = new Set([
  "user",
  "author",
  "quoted_user",
  "retweeted_user",
  // Every entry is a person: `entities.user_mentions[]` carries a name, a
  // handle and the account's own id. The first run pseudonymised the first two
  // and committed eight of the third, because the container was not named.
  "user_mentions",
]);

/**
 * `full_text` and `text` hold the tweet, which is the one thing a classifier
 * reads. They are never scrubbed — a rule that touched them would leave a
 * fixture that agrees with any parser at all. A handle inside the text is
 * pseudonymised by the mention pass instead.
 */
function scrubMentions(value, pseudonym) {
  return value.replace(/@([A-Za-z0-9_]{2,15})\b/g, (_, handle) => `@${pseudonym(handle)}`);
}

/** `x.com/<handle>/status/<id>`: the handle is identity, the id is the post. */
function scrubStatusUrl(value, pseudonym) {
  const match = value.match(
    /^(https?:\/\/(?:www\.)?(?:x|twitter)\.com)\/([^/?#]+)\/status\/(\d+)(.*)$/i,
  );
  if (!match) return undefined;

  const [, origin, handle, id, tail] = match;
  return `${origin}/${pseudonym(handle)}/status/${id}${tail}`;
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

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        const childIsPerson = insidePerson || personContainers.has(key);

        if (typeof child === "string" && child !== "") {
          // The tweet itself, kept whole apart from the handles inside it.
          if (key === "full_text" || key === "text") {
            return [key, scrubMentions(child, pseudonym)];
          }
          // `id_str` is the tweet id at the top level and the account id
          // inside a user — the first is the deduplication key and must
          // survive, the second names a person for as long as the account
          // exists. The first run committed the account id, which is the same
          // mistake US-057's LinkedIn capture made with `author.id`. Only the
          // container tells them apart.
          if (childIsPerson && (key === "id_str" || key === "id")) {
            return [key, pseudonym(child)];
          }
          if (identityFields.has(key)) return [key, pseudonym(child)];
          if (identityUrlFields.has(key)) {
            return [key, `https://scrubbed.invalid/${pseudonym(child)}`];
          }
          if (personalTextFields.has(key) && childIsPerson) return [key, scrubbedText];

          const status = scrubStatusUrl(child, pseudonym);
          if (status) return [key, status];
        }

        // Numbers, not strings: `user.id` and `in_reply_to_user_id` both
        // arrive as one and the string branch above never sees them. Both name
        // an account. Every other long number here — `conversation_id_str`,
        // `in_reply_to_status_id`, `quoted_status_id` — names a *post* and has
        // to survive, which is why this is keyed rather than done by shape.
        if (
          typeof child === "number" &&
          (identityFields.has(key) || (childIsPerson && (key === "id" || key === "id_str")))
        ) {
          return [key, pseudonym(String(child))];
        }

        return [key, scrub(child, childIsPerson && typeof child === "object")];
      }),
    );
  }

  return { scrub: (value) => scrub(value), replaced: () => pseudonyms.size };
}

// ------------------------------------------------------------------ http

async function call(path, { key = apiKey } = {}) {
  const startedAt = Date.now();

  const response = await fetch(`${api}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
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

/** What the account has left, in dollars, or null when it cannot be read. */
async function balance() {
  const answer = await call("/user/balance");
  const value = answer.body?.balance_usd;
  return typeof value === "number" ? value : null;
}

// ------------------------------------------------------------- capturing

const written = [];
const ledger = [];
const answers = new Map();

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
 * One call, its cost read from the balance either side of it.
 *
 * The provider reports no per-call charge, so the only honest instrument is
 * its own balance. That is the same reasoning US-025 used on ScrapeCreators
 * before `credits_charged` was found: a claim about somebody's bill is checked
 * against the provider's own number, not against ours.
 */
async function capture(name, path, options = {}) {
  console.log(`\n${name}`);

  const before = await balance();
  const answer = await call(path, options);
  const after = await balance();

  const spent = before !== null && after !== null ? Math.round((before - after) * 1e6) / 1e6 : null;

  ledger.push({
    call: name,
    path,
    httpStatus: answer.status,
    elapsedMs: answer.elapsedMs,
    balanceBefore: before,
    balanceAfter: after,
    spentUsd: spent,
    note: options.note ?? null,
  });

  console.log(
    `  ${answer.status} in ${answer.elapsedMs} ms, spent $${spent ?? "(unknown)"}, ` +
      `$${after ?? "?"} left`,
  );

  answers.set(name, answer);
  save(
    name,
    { httpStatus: answer.status, body: answer.body },
    {
      method: "GET",
      path,
      ...(options.note ? { note: options.note } : {}),
    },
  );

  return answer;
}

// ------------------------------------------------------------ describing

function tweetsOf(answer) {
  const list = answer?.body?.tweets;
  return Array.isArray(list) ? list : [];
}

function datesOf(tweets) {
  return tweets
    .map((tweet) => {
      const raw = tweet?.tweet_created_at;
      const parsed = raw ? new Date(raw) : null;
      return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
    })
    .filter((value) => value !== null);
}

function describe(name) {
  const answer = answers.get(name);
  if (!answer) return null;

  const tweets = tweetsOf(answer);
  const dates = datesOf(tweets);
  const sorted = [...dates].sort();

  return {
    call: name,
    httpStatus: answer.status,
    elapsedMs: answer.elapsedMs,
    tweets: tweets.length,
    fields: tweets[0] ? Object.keys(tweets[0]) : [],
    hasUrlField: tweets[0] ? Object.keys(tweets[0]).some((key) => /url/i.test(key)) : null,
    ids: tweets.map((tweet) => tweet?.id_str ?? null),
    newest: sorted.at(-1) ?? null,
    oldest: sorted[0] ?? null,
    orderedNewestFirst:
      dates.length > 1 && dates.every((value, index) => index === 0 || value <= dates[index - 1]),
    nextCursor: answer?.body?.next_cursor ?? null,
  };
}

// ---------------------------------------------------------------- the run

console.log("Asking SocialData about X. This spends from the account balance.");

const opening = await balance();
console.log(`balance before the run: $${opening ?? "(unreadable)"}`);

if (opening !== null && opening <= 0) {
  console.error("The balance is empty. The API answers 402 until it is topped up.");
  process.exit(1);
}

/** Question 8, and free: a key that cannot be real. */
console.log("\ncredentials-rejected");
const refused = await call(`/twitter/search?query=${encodeURIComponent(keyword)}`, {
  key: "not-a-real-key",
});
console.log(`  ${refused.status} in ${refused.elapsedMs} ms`);
ledger.push({
  call: "credentials-rejected",
  httpStatus: refused.status,
  spentUsd: 0,
  note: "sent with a deliberately invalid key; the balance is another account's",
});
save(
  "credentials-rejected",
  { httpStatus: refused.status, body: refused.body },
  {
    method: "GET",
    note: "invalid key",
  },
);

/** Questions 1, 2, 3, 4 and 6. The call everything else is compared against. */
const latest = await capture(
  "search-latest",
  `/twitter/search?query=${encodeURIComponent(keyword)}&type=Latest`,
  { note: "type=Latest, no window" },
);

/** Question 5: does a window inside the query narrow the answer? */
const since = Math.floor((Date.now() - windowHours * 60 * 60 * 1000) / 1000);

await capture(
  "search-since",
  `/twitter/search?query=${encodeURIComponent(`${keyword} since_time:${since}`)}&type=Latest`,
  { note: `since_time:${since}, which is ${windowHours}h back` },
);

/** Does the cursor buy different tweets? */
const cursor = latest?.body?.next_cursor;

if (typeof cursor === "string" && cursor !== "") {
  await capture(
    "search-page-2",
    `/twitter/search?query=${encodeURIComponent(keyword)}&type=Latest&cursor=${encodeURIComponent(cursor)}`,
    { note: "the cursor from search-latest" },
  );
} else {
  console.log("\nsearch-page-2\n  skipped: the first answer named no cursor");
}

/** Question 7. Billed in full, refunded, or free? */
await capture(
  "search-no-results",
  `/twitter/search?query=${encodeURIComponent(impossible)}&type=Latest`,
  { note: "a phrase that cannot occur" },
);

// ------------------------------------------------------------ the answers

const closing = await balance();

const findings = {
  note:
    "US-060. What SocialData's X search returns and what it costs, computed " +
    "from the answers in this folder.",
  capturedAt: new Date().toISOString(),
  balanceBefore: opening,
  balanceAfter: closing,
  totalSpentUsd:
    opening !== null && closing !== null ? Math.round((opening - closing) * 1e6) / 1e6 : null,
  calls: [...answers.keys()].map(describe).filter((entry) => entry !== null),
};

const first = findings.calls.find((entry) => entry.call === "search-latest");
const windowed = findings.calls.find((entry) => entry.call === "search-since");
const page2 = findings.calls.find((entry) => entry.call === "search-page-2");
const empty = findings.calls.find((entry) => entry.call === "search-no-results");

if (first) {
  const perCall = ledger.find((entry) => entry.call === "search-latest")?.spentUsd ?? null;

  findings.summary = {
    tweetsPerPage: first.tweets,
    spentOnOneCall: perCall,
    microDollarsPerTweet:
      perCall !== null && first.tweets > 0 ? Math.round((perCall * 1e6) / first.tweets) : null,
    orderedNewestFirst: first.orderedNewestFirst,
    newestTweet: first.newest,
    oldestTweet: first.oldest,
    hasUrlField: first.hasUrlField,
    windowNarrows:
      windowed && first.oldest && windowed.oldest ? windowed.oldest > first.oldest : null,
    windowOldest: windowed?.oldest ?? null,
    secondPageRepeats: page2 ? first.ids.filter((id) => page2.ids.includes(id)).length : null,
    emptySearchTweets: empty?.tweets ?? null,
    emptySearchCost: ledger.find((entry) => entry.call === "search-no-results")?.spentUsd ?? null,
  };

  // Compared against SocialCrawl's 406 micro-dollars a post, which is one
  // credit at 8,118 for twenty posts.
  if (findings.summary.microDollarsPerTweet !== null) {
    findings.summary.dollarsPerFiftyPosts =
      Math.round(findings.summary.microDollarsPerTweet * 50) / 1e6;
  }
}

writeFileSync(`${here}findings.json`, `${JSON.stringify(findings, null, 2)}\n`);

writeFileSync(
  `${here}manifest.json`,
  `${JSON.stringify(
    {
      note:
        "Which request produced each file. Captured from the live API; see " +
        "docs/testing.md on why these are captured and never written.",
      provider: "socialdata",
      platform: "x",
      api,
      files: written,
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
        "What each call did to the account balance. This provider reports no " +
        "per-call charge, so its own balance either side of a call is the only " +
        "honest instrument.",
      balanceBefore: opening,
      balanceAfter: closing,
      calls: ledger,
    },
    null,
    2,
  )}\n`,
);

console.log("\n---");
console.log(`wrote ${written.length} fixtures, findings.json, manifest.json and ledger.json`);
console.log(`balance $${opening} to $${closing}`);

if (findings.summary) {
  const s = findings.summary;
  console.log(
    [
      "",
      `tweets per page     ${s.tweetsPerPage}`,
      `one call cost       $${s.spentOnOneCall ?? "(unknown)"}`,
      `per tweet           ${s.microDollarsPerTweet ?? "?"} micro-dollars — SocialCrawl is 406`,
      `fifty posts         $${s.dollarsPerFiftyPosts ?? "?"} — SocialCrawl is $0.0203`,
      `ordered by date     ${s.orderedNewestFirst ? "yes, newest first" : "no"}`,
      `newest tweet        ${s.newestTweet ?? "—"}`,
      `oldest tweet        ${s.oldestTweet ?? "—"}`,
      `a url field         ${s.hasUrlField ? "yes" : "no — one must be built"}`,
      `since_time narrows  ${s.windowNarrows === null ? "(not comparable)" : s.windowNarrows ? "yes" : "no"}`,
      `  windowed oldest   ${s.windowOldest ?? "—"}`,
      `page 2 repeats      ${s.secondPageRepeats ?? "(no page 2)"} of page 1`,
      `empty search        ${s.emptySearchTweets ?? "?"} tweets, cost $${s.emptySearchCost ?? "?"}`,
    ].join("\n"),
  );
}

// Question 3, and the only part a script cannot answer. US-047: a URL format
// we invent is evidence about our own string building and none about the
// platform, so this prints a real one for a person to open.
const sample = tweetsOf(latest)[0];

if (sample) {
  const handle = sample?.user?.screen_name;
  const id = sample?.id_str;
  console.log(
    `\nOpen this to answer question 3 — it is built, not returned:\n  https://x.com/${handle}/status/${id}`,
  );
}

console.log("\nRead the fixtures before committing them.");
