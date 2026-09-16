#!/usr/bin/env node
/**
 * Ask ScrapeCreators what a LinkedIn search costs and what it returns.
 *
 * US-054. US-053 switched LinkedIn off because SocialCrawl charges five
 * credits for ten posts, which is $0.2030 for fifty. ScrapeCreators bills one
 * credit a request at $0.00188 on Reddit, so the same fifty posts could cost
 * $0.0094 or $0.0038 depending on a page size nobody has measured. This script
 * is how those numbers stop being arithmetic on an assumption.
 *
 * It is a measurement, not a parser's fixture set. No connector reads what it
 * writes yet, and none should be written until somebody has read the answers.
 *
 * Its own folder, not the Reddit one beside it. Two capture scripts writing
 * one `manifest.json` means a full run of either erases the other's record of
 * where its payloads came from.
 *
 * Four numbers decide whether LinkedIn comes back, and the ticket asks for all
 * four:
 *
 *   1. How many posts does one page hold? The provider publishes no page size,
 *      and the whole price comparison rests on it.
 *   2. How many credits does one call cost? The Reddit endpoints bill one and
 *      report `credits_charged` on every answer. That is a fact about those
 *      endpoints, not about this one.
 *   3. Is the answer ordered by date or by relevance? US-028 measured
 *      SocialCrawl's LinkedIn answers running 22 August, 22 August, 4
 *      September, 31 August, 15 August — relevance, not date — which is why
 *      the X connector's "the page is older than `since`, stop paging" rule is
 *      absent there. The same question has to be asked here.
 *   4. How old is the newest post? This one can kill the platform on its own.
 *      The endpoint finds posts through Google Search and then scrapes the
 *      public page, so a post has to be indexed before it can be found, and
 *      this product wants somebody who wrote something this week.
 *
 * Four more the connector would need, asked here because they are nearly free:
 *
 *   5. What does a refused key say, and with what status? A refusal and an
 *      outage lead to different actions.
 *   6. Is a credential probe free? Measured against the account's own balance,
 *      the way US-025 measured it for Reddit.
 *   7. Which `date_posted` values exist? The documentation names the parameter
 *      and not its values. An invalid one is the cheapest way to make a
 *      provider list the valid ones, and it is how US-025 learned that a
 *      `timeframe` is refused beside `sort=new`.
 *   8. Does a search that finds nothing still bill? SocialCrawl bills a
 *      LinkedIn search that matches nothing in full and answers with ten
 *      unrelated posts; ScrapeCreators bills an unknown subreddit and returns
 *      an empty list. There is no safe assumption to make here.
 *
 * Run it with your own key:
 *
 *     node packages/core/src/sources/providers/scrapecreators/linkedin-fixtures/capture.mjs
 *     node .../capture.mjs --only=search
 *
 * The default run makes four billed calls and three probes that are expected
 * to be free. At one credit a call that is under a cent; if a LinkedIn call
 * costs what SocialCrawl's does, it is four cents. The ledger says which.
 *
 * What it writes, into this folder:
 *
 *   <name>.json     one whole response body, with author identity scrubbed
 *   manifest.json   which request produced each file, and when
 *   ledger.json     what each call did to the account's credit balance
 *   findings.json   the four numbers, computed from the answers above
 *
 * **Read the fixtures before committing them.** The scrubbing rules below came
 * from the SocialCrawl LinkedIn capture, whose first run committed real names
 * and real job headlines because it decided what a person was by sniffing for
 * fields that provider does not use. This is a different provider returning a
 * different shape, so the same mistake is available again, in a new place.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));

const api = "https://api.scrapecreators.com/v1/linkedin";

/** The one endpoint that finds a stranger. The other five need a name first. */
const endpoint = `${api}/search/posts`;

/**
 * The query US-028 ran against SocialCrawl's LinkedIn search, so the two
 * providers are compared on one question rather than on two.
 *
 * It is also two words. US-027 caps an X query at four and a Reddit query at
 * eight, and what a LinkedIn query may be here is not this ticket's question —
 * a long phrase is a second call and the run stays lean.
 */
const keyword = "flaky tests";

/**
 * A phrase that cannot occur, for question 8.
 *
 * The same shape US-028 used: ordinary words in an order nobody writes.
 */
const impossible = "kumquat velocipede telemetry brunch";

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
      "The same key fetches Reddit. A new account gets 100 credits and needs no",
      "card. Get one at https://scrapecreators.com.",
    ].join("\n"),
  );
  process.exit(1);
}

// ------------------------------------------------------------- scrubbing

/**
 * The rules below are LinkedIn's, not this provider's, so they are the same
 * rules `socialcrawl/linkedin-fixtures/capture.mjs` carries. Keep them
 * together when either changes: the platform puts names in the same places
 * whoever scraped the page.
 *
 * They are also not enough on their own. This provider's shape is unknown
 * until the first run, and the field list can only cover what somebody has
 * seen. Read what this writes.
 */
const identityFields = new Set([
  "author",
  "author_name",
  "author_handle",
  "author_url",
  "username",
  "user_name",
  "public_identifier",
  "vanity_name",
  "first_name",
  "last_name",
  "full_name",
  "display_name",
  "company",
  "company_name",
  "organization",
]);

/** Identity that arrives as a URL. Scrubbed to a URL, so the shape survives. */
const identityUrlFields = new Set([
  "profile_url",
  "profile_picture",
  "profile_image_url",
  "profile_picture_url",
  "avatar",
  "avatar_url",
  "logo",
  "logo_url",
  "company_url",
  "author_profile_url",
]);

/**
 * Free text a person wrote about themselves. Not parsed, and not ours to keep.
 *
 * `title` and `text` are deliberately absent: on a search result they hold the
 * post itself, which is the one thing a classifier would read. A rule that
 * scrubbed them would leave a fixture that agrees with any parser at all.
 */
const personalTextFields = new Set([
  "headline",
  "description",
  "bio",
  "summary",
  "location",
  "occupation",
  "job_title",
  "subtitle",
]);

const scrubbedText = "Scrubbed by capture.mjs. See docs/testing.md.";

/**
 * A key whose value is a whole person, however that person is described.
 *
 * Naming the container rather than guessing at its contents is the fix US-028
 * arrived at after committing real names once. Everything under one of these
 * is identity until proven otherwise, whatever the provider renames its fields
 * to next.
 */
const personContainers = new Set([
  "author",
  "user",
  "member",
  "profile",
  "actor",
  "poster",
  "company",
  "organization",
]);

/**
 * `name` is a display name on a person and something else everywhere else, so
 * it is scrubbed only inside an object that already looks like one.
 */
function looksLikeAPerson(value) {
  return ["headline", "public_identifier", "profile_url", "first_name", "vanity_name"].some(
    (key) => key in value,
  );
}

/** A profile photo is identity, and it arrives on LinkedIn's media host. */
function isMediaUrl(value) {
  return /^https?:\/\/[^/]*licdn\.com\//i.test(value);
}

/**
 * A LinkedIn URL carries identity in its path, and the post URL is the worst
 * case: `linkedin.com/posts/<person-slug>_<activity-id>` puts somebody's name
 * in front of the one part a parser reads. The slug is pseudonymised and the
 * activity id is kept whole.
 */
function scrubLinkedInUrl(value, pseudonym) {
  const match = value.match(
    /^(https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com)\/([^/?#]+)\/([^?#]*)(.*)$/i,
  );
  if (!match) return undefined;

  const [, origin, section, rest, tail] = match;

  if (section === "posts" || section === "pulse") {
    // The **first** underscore, not the last. A LinkedIn post path is
    // `<person-slug>_<title-slug>-activity-<id>-<hash>`, and the slugs use
    // hyphens, so the first underscore is the separator. The first run of this
    // script cut at the last one and destroyed the activity id of the one post
    // whose title held an underscore — and the URL is the only identifier this
    // provider returns, so that id is what deduplication would rest on.
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
 * post. Only the first is identity, and it keeps its shape.
 */
function scrubUrn(value, pseudonym) {
  const match = value.match(/^urn:li:(person|member|fsd_profile|organization|company):(.+)$/i);
  if (!match) return undefined;

  const [, kind, id] = match;
  return `urn:li:${kind}:${pseudonym(id)}`;
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

    const person = insidePerson || looksLikeAPerson(value);

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        const childIsPerson = person || personContainers.has(key);

        if (typeof child === "string" && child !== "") {
          if (identityFields.has(key)) return [key, pseudonym(child)];
          if (key === "name" && childIsPerson) return [key, pseudonym(child)];
          if (identityUrlFields.has(key)) {
            return [key, `https://scrubbed.invalid/${pseudonym(child)}`];
          }
          if (personalTextFields.has(key) && childIsPerson) return [key, scrubbedText];
          if (person && isMediaUrl(child)) {
            return [key, `https://scrubbed.invalid/${pseudonym(child)}`];
          }

          const url = scrubLinkedInUrl(child, pseudonym);
          if (url) return [key, url];

          const urn = scrubUrn(child, pseudonym);
          if (urn) return [key, urn];
        }

        return [key, scrub(child, childIsPerson && typeof child === "object")];
      }),
    );
  }

  return { scrub: (value) => scrub(value), replaced: () => pseudonyms.size };
}

// ------------------------------------------------------------------ http

/**
 * One request. Returns the status, the parsed body and the wall-clock time it
 * took, and never throws on a failure status: a rejection is a payload we want
 * captured too.
 *
 * The elapsed time is evidence in its own right. This endpoint searches Google
 * and then scrapes the pages it finds, so it may be far slower than the Reddit
 * ones, and a poll's timeout is set from a real number or from nothing.
 */
async function request(url, { key = apiKey } = {}) {
  const startedAt = Date.now();

  const response = await fetch(url, { headers: { "x-api-key": key } });
  const text = await response.text();

  // Not every answer is JSON. Keep a non-JSON body as the string it was on the
  // wire: wrapping it in an object of our own invention would make the fixture
  // a record of this script rather than of the provider.
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  return { status: response.status, body: parsed, elapsedMs: Date.now() - startedAt };
}

function url(params) {
  return `${endpoint}?${new URLSearchParams(params)}`;
}

// ------------------------------------------------------------- capturing

const written = [];
const ledger = [];
const answers = new Map();

/** What the account had left, if the provider says so. */
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
 * hole in it cannot answer "was the probe billed?", which is question 6.
 */
async function capture(name, params, options = {}) {
  console.log(`\n${name}`);

  const target = url(params);
  const answer = await request(target, options);
  answers.set(name, answer);

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
    { method: "GET", url: target, ...(options.note ? { note: options.note } : {}) },
  );

  return answer;
}

// ------------------------------------------------------------ describing

/**
 * Find the list of posts in an answer whose shape nobody has seen.
 *
 * The provider may call it `posts`, `results`, `data` or something else, and a
 * script that hard-codes one name reports "no posts" for an answer that is
 * full of them. So the longest array of objects wins, and its key is reported
 * rather than assumed.
 */
function findItems(body) {
  if (!body || typeof body !== "object") return { key: null, items: [] };

  let best = { key: null, items: [] };

  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value) && value.every((entry) => entry && typeof entry === "object")) {
      if (value.length > best.items.length) best = { key, items: value };
    }
  }

  return best;
}

/**
 * Every date in one item, whatever it is called.
 *
 * Question 3 asks about ordering and question 4 about age, and both need a
 * date before anybody knows which field holds one. A value counts if it parses
 * to a real instant inside a plausible window — a like count of 1755 is a
 * valid year and is not a date.
 */
function datesIn(item) {
  const found = [];

  for (const [key, value] of Object.entries(item)) {
    if (typeof value !== "string" && typeof value !== "number") continue;

    const parsed = new Date(typeof value === "number" ? value : String(value));
    if (Number.isNaN(parsed.getTime())) continue;

    const year = parsed.getUTCFullYear();
    if (year < 2004 || year > 2100) continue;
    if (typeof value === "number") continue;

    found.push({ field: key, value: String(value), at: parsed.toISOString() });
  }

  return found;
}

/** Whichever date field the most items carry, so one field describes the page. */
function primaryDateField(items) {
  const counts = new Map();

  for (const item of items) {
    for (const { field } of datesIn(item)) {
      counts.set(field, (counts.get(field) ?? 0) + 1);
    }
  }

  let best = null;
  for (const [field, count] of counts) {
    if (!best || count > best.count) best = { field, count };
  }

  return best;
}

function describe(name) {
  const answer = answers.get(name);
  if (!answer) return null;

  const { key, items } = findItems(answer.body);
  const date = primaryDateField(items);

  const dates = date
    ? items
        .map((item) => datesIn(item).find((entry) => entry.field === date.field)?.at ?? null)
        .filter((value) => value !== null)
    : [];

  const sorted = [...dates].sort();
  const descending =
    dates.length > 1 && dates.every((value, index) => index === 0 || value <= dates[index - 1]);

  return {
    call: name,
    httpStatus: answer.status,
    elapsedMs: answer.elapsedMs,
    creditsCharged: creditsCharged(answer.body) ?? null,
    topLevelKeys: answer.body && typeof answer.body === "object" ? Object.keys(answer.body) : [],
    itemsKey: key,
    itemCount: items.length,
    itemKeys: items[0] ? Object.keys(items[0]) : [],
    dateField: date?.field ?? null,
    newest: sorted.at(-1) ?? null,
    oldest: sorted[0] ?? null,
    orderedNewestFirst: descending,
    /** Whether an id repeats inside one page, which would make paging a lie. */
    ids: items
      .map((item) => item.id ?? item.post_id ?? item.urn ?? item.url ?? null)
      .filter((value) => value !== null),
  };
}

// ---------------------------------------------------------------- the run

const only = process.argv
  .filter((argument) => argument.startsWith("--only="))
  .map((argument) => argument.slice("--only=".length));

const wanted = (name) => only.length === 0 || only.some((part) => name.includes(part));

console.log("Asking ScrapeCreators about LinkedIn. This spends credits from your allowance.");

/**
 * Question 5 and question 6: what a refusal looks like, and whether a probe is
 * free. The accepted probe is a search with no `query`, which the provider has
 * to refuse on the input rather than on the key — the same shape that proved
 * the Reddit probe free in US-025.
 */
if (wanted("credentials")) {
  await capture(
    "credentials-rejected",
    { query: keyword },
    { key: "not-a-real-key", note: "sent with a deliberately invalid key" },
  );

  await capture(
    "credentials-accepted",
    {},
    { note: "a working key with no query: refused on the input, not on the key" },
  );
}

/**
 * Question 7. An invalid `date_posted` is the cheapest way to make a provider
 * list the valid ones, and it costs nothing when the refusal happens before
 * the work.
 */
let dateValues = [];

if (wanted("dates")) {
  const refusal = await capture(
    "date-rejected",
    { query: keyword, date_posted: "yesterday-ish" },
    { note: "an invalid date_posted, to make the provider name the valid ones" },
  );

  // Match the provider's own vocabulary rather than a guess at it. The first
  // run looked for `past-week` and found nothing, because this provider says
  // `last-week` — so the window question stayed open over a regular
  // expression. Both prefixes are accepted now; the refusal is the authority.
  const message = JSON.stringify(refusal.body ?? "");
  dateValues = [...new Set(message.match(/(?:last|past)[_-][a-z]+/gi) ?? [])];

  console.log(
    dateValues.length > 0
      ? `  the refusal names: ${dateValues.join(", ")}`
      : "  the refusal names no values; the window question stays open",
  );
}

/** Questions 1 to 4, and the only call that answers any of them. */
if (wanted("search")) {
  await capture("search-posts", { query: keyword });
}

/**
 * Does paging buy new posts? The documentation says the cursor stops at 11, so
 * a page is not a cursor string here but a number, and page two either holds
 * different posts or the connector may never ask for it.
 */
if (wanted("page")) {
  await capture("search-page-2", { query: keyword, cursor: "2" }, { note: "the second page" });
}

/**
 * Does the window narrow the answer, or is the parameter decoration? A
 * parameter that is accepted and ignored costs a poll its whole history every
 * time, which is the bug BUG-002 was.
 */
if (wanted("window")) {
  // `last-week` of the five the provider named on 2026-09-07: last-hour,
  // last-day, last-week, last-month, last-year. It is written here so the
  // window block can run alone, and it is still checked — the refusal above is
  // the authority whenever the dates block runs in the same pass.
  const value = dateValues.find((entry) => entry === "last-week") ?? dateValues[0] ?? "last-week";

  await capture(
    "search-last-week",
    { query: keyword, date_posted: value },
    {
      note: `date_posted=${value}${dateValues.length > 0 ? ", named by the refusal" : ", from the refusal recorded on 2026-09-07"}`,
    },
  );
}

/** Question 8. Billed in full, or refunded, or empty? */
if (wanted("empty")) {
  await capture("search-no-results", { query: impossible }, { note: "a phrase that cannot occur" });
}

// ------------------------------------------------------------ the answers

const findings = {
  note:
    "US-054. The four numbers that decide whether LinkedIn is worth offering " +
    "through this provider, computed from the answers in this folder.",
  capturedAt: new Date().toISOString(),
  calls: [...answers.keys()].map(describe).filter((entry) => entry !== null),
};

const search = findings.calls.find((entry) => entry.call === "search-posts");
const page2 = findings.calls.find((entry) => entry.call === "search-page-2");

if (search) {
  const overlap = page2 ? search.ids.filter((id) => page2.ids.includes(id)).length : null;

  findings.summary = {
    postsPerPage: search.itemCount,
    creditsPerCall: search.creditsCharged,
    orderedNewestFirst: search.orderedNewestFirst,
    newestPost: search.newest,
    oldestPost: search.oldest,
    secondPageRepeats: overlap,
  };

  // The price of fifty posts, which is the number US-053 turned LinkedIn off
  // over. One credit is 1,880 micro-dollars: the $47 pack of 25,000, the same
  // figure `scrapecreators/reddit.ts` carries and for the same reason — it is
  // the dearest per credit, and over-reporting a bill is the safe direction.
  if (search.itemCount > 0 && typeof search.creditsCharged === "number") {
    const perPost = (search.creditsCharged * 1880) / search.itemCount;
    findings.summary.microDollarsPerPost = Math.round(perPost);
    findings.summary.dollarsPerFiftyPosts = Number(((perPost * 50) / 1_000_000).toFixed(4));
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
      provider: "scrapecreators",
      platform: "linkedin",
      endpoint,
      files: written,
    },
    null,
    2,
  )}\n`,
);

const spent = ledger.reduce((total, call) => total + (call.creditsCharged ?? 0), 0);
const balances = ledger.map((call) => call.creditsRemaining).filter((value) => value !== null);

writeFileSync(
  `${here}ledger.json`,
  `${JSON.stringify(
    {
      note:
        "What each captured call cost, in the provider's own numbers. This is " +
        "the evidence for the billable unit and for whether a probe is free.",
      creditsCharged: spent,
      balanceBefore: balances[0] ?? null,
      balanceAfter: balances.at(-1) ?? null,
      calls: ledger,
    },
    null,
    2,
  )}\n`,
);

console.log("\n---");
console.log(`wrote ${written.length} fixtures, findings.json, manifest.json and ledger.json`);
console.log(`the run charged ${spent} credit${spent === 1 ? "" : "s"}`);

if (findings.summary) {
  const s = findings.summary;
  console.log(
    [
      "",
      `posts per page      ${s.postsPerPage}`,
      `credits per call    ${s.creditsPerCall ?? "(not reported)"}`,
      `ordered by date     ${s.orderedNewestFirst ? "yes, newest first" : "no"}`,
      `newest post         ${s.newestPost ?? "(no date field found)"}`,
      `oldest post         ${s.oldestPost ?? "(no date field found)"}`,
      `page 2 repeats      ${s.secondPageRepeats ?? "(page 2 not fetched)"} of page 1`,
      s.dollarsPerFiftyPosts !== undefined
        ? `fifty posts cost    $${s.dollarsPerFiftyPosts} — SocialCrawl charges $0.2030`
        : "fifty posts cost    (not computable: no count or no charge reported)",
    ].join("\n"),
  );
}

console.log("\nRead the fixtures before committing them. US-028's first run leaked real names.");
