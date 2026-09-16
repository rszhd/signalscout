#!/usr/bin/env node
/**
 * Ask HarvestAPI's Apify actor what a LinkedIn search returns and what it
 * costs.
 *
 * US-056, and the third provider measured for one platform. SocialCrawl works
 * and costs $0.2030 for fifty posts. ScrapeCreators costs $0.0094 and was
 * built, tested and dropped in US-055 because it finds posts through Google's
 * index rather than through LinkedIn. This one searches LinkedIn, claims to
 * need no cookies and no account, and bills per post.
 *
 * It is a measurement, not a parser's fixture set. No connector reads what it
 * writes yet, and none should be written until somebody has read the answers.
 *
 * **Apify is a provider this repository has never used**, so the run model is
 * itself one of the questions. An actor run is asynchronous — start it, poll
 * it, then read its dataset — which is Bright Data's snapshot shape rather
 * than the synchronous one both other LinkedIn providers have. This script
 * uses the asynchronous flow deliberately, because a capture that took a
 * shortcut the connector cannot take would measure the wrong thing.
 *
 * Nine questions, from the ticket:
 *
 *   1. What is one post on the wire? Every field, including the ones a parser
 *      would not read today, because a fixture trimmed to today's parser stops
 *      being evidence tomorrow.
 *   2. **Is the id the activity id?** SocialCrawl returns
 *      `7500190661334249473` and ScrapeCreators puts the same number inside the
 *      post URL. If this provider agrees, all three deduplicate against each
 *      other and `posts` needs nothing new.
 *   3. What does a run report as charged? The run object carries
 *      `usageTotalUsd` and `chargedEventCounts`, so `unitsConsumed` is measured
 *      rather than assumed.
 *   4. **Does `sortBy: "date"` really sort?** No other LinkedIn provider offers
 *      it, and the early-stop rule would rest on it. A parameter accepted and
 *      ignored is the shape of BUG-002.
 *   5. Does `postedLimit` narrow the answer?
 *   6. What does a query matching nothing return and cost? The actor's own
 *      price list names a `no-result` event at $0.001, so it is not free —
 *      this checks that the event is what actually fires.
 *   7. What does a refused token say, with what status, and is that free?
 *   8. **How long does a run take?** It decides whether a connector waits
 *      inside one job or hands a continuation back to the scheduler.
 *   9. Are comments in the answer, and what would they cost? They are not
 *      turned on here: `scrapeComments` is charged per comment, and the
 *      question is the price, not the contents.
 *
 * Run it with your own token:
 *
 *     node packages/core/src/sources/providers/apify/linkedin-fixtures/capture.mjs
 *     node .../capture.mjs --only=search
 *
 * **Prices are tiered by Apify plan, and this account is on FREE.** A post is
 * $0.002 there and $0.0015 on GOLD and above, which is why the actor's page
 * says $1.50 per 1,000 and a free account pays $2. Read from the actor's own
 * `pricingInfos` on 2026-09-07, not from the marketing page. The default run
 * asks for ten posts twice and one empty query: about $0.042.
 *
 * What it writes, into this folder:
 *
 *   <name>.json     the dataset items, with author identity scrubbed
 *   manifest.json   which run produced each file, and its input
 *   ledger.json     what each run was charged, in the provider's own numbers
 *   findings.json   the answers to the questions above, computed
 *
 * **Read the fixtures before committing them.** The scrubbing rules came from
 * the two earlier LinkedIn captures, and the first of those committed real
 * names and job headlines because it decided what a person was by sniffing for
 * fields that provider did not use. This is a third shape, so the same mistake
 * is available again in a new place.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));

const api = "https://api.apify.com/v2";
const actor = "harvestapi~linkedin-post-search";

/**
 * The query the two earlier captures used, so three providers are compared on
 * one question rather than on three.
 */
const keyword = "flaky tests";

/** A phrase that cannot occur, for question 6. */
const impossible = "kumquat velocipede telemetry brunch";

/**
 * How many posts each run may buy.
 *
 * `maxPosts: 0` means *every post there is* on this actor. It is never sent.
 * Ten is enough to answer every question here and costs two cents.
 */
const maxPosts = 10;

/** How long to wait for a run before giving up, and how often to look. */
const runTimeoutMs = 5 * 60 * 1000;
const pollIntervalMs = 3000;

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

const apiToken = process.env.APIFY_API_TOKEN || readEnvFile(`${root}.env`).APIFY_API_TOKEN;

if (!apiToken) {
  console.error(
    [
      "No Apify token. Set APIFY_API_TOKEN in .env, or in the environment.",
      "",
      "Get one from the Apify console under Settings, Integrations. The actor is",
      "harvestapi/linkedin-post-search, and it needs no LinkedIn account.",
    ].join("\n"),
  );
  process.exit(1);
}

// ------------------------------------------------------------- scrubbing

/**
 * The rules are LinkedIn's, not this provider's, so they are the rules both
 * earlier captures carry. Keep the three together when any one changes: the
 * platform puts names in the same places whoever scraped the page.
 *
 * They cannot be complete on a shape nobody has seen. Read what this writes.
 */
const identityFields = new Set([
  "author",
  "authorName",
  "author_name",
  "authorHeadline",
  "name",
  "fullName",
  "firstName",
  "lastName",
  "publicIdentifier",
  "universalName",
  "username",
  "handle",
  "company",
  "companyName",
  "organization",
]);

/**
 * Identity that arrives as a URL. Scrubbed to a URL, so the shape survives.
 *
 * `linkedinUrl` is deliberately **not** here, and the first run of this script
 * is why: on a post that field is the post's own URL, and replacing it whole
 * destroyed the activity id — the same mistake US-054 made by cutting a URL at
 * the wrong underscore. It is handled by `scrubLinkedInUrl` instead, which
 * pseudonymises the person slug and keeps the id, and which pseudonymises an
 * `/in/<slug>` profile URL correctly too.
 */
const identityUrlFields = new Set([
  "authorUrl",
  "profileUrl",
  "publicProfileUrl",
  "picture",
  "pictureUrl",
  "profilePicture",
  "avatar",
  "avatarUrl",
  "logo",
  "logoUrl",
  "companyUrl",
]);

/**
 * Free text a person wrote about themselves. Not parsed, and not ours to keep.
 *
 * `content` and `text` are deliberately absent: on a search result they hold
 * the post itself, which is the one thing a classifier would read. A rule that
 * scrubbed them would leave a fixture that agrees with any parser at all.
 */
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
  // The author's headline on this provider, and the first run committed one in
  // full: "SDET & Automation Engineer | Playwright & TypeScript | ...". A field
  // list can only cover what somebody has seen, which is why the fixtures are
  // read before they are committed.
  "info",
]);

const scrubbedText = "Scrubbed by capture.mjs. See docs/testing.md.";

/**
 * A key whose value is a whole person, however that person is described.
 *
 * Naming the container rather than guessing at its contents is what US-028
 * arrived at after committing real names once.
 */
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

/** A profile photo is identity, and it arrives on LinkedIn's media host. */
function isMediaUrl(value) {
  return /^https?:\/\/[^/]*licdn\.com\//i.test(value);
}

/**
 * A LinkedIn URL carries identity in its path, and the post URL is the worst
 * case: `linkedin.com/posts/<person-slug>_<title-slug>-activity-<id>-<hash>`
 * puts somebody's name in front of the one part a parser reads.
 *
 * The slug is pseudonymised at the **first** underscore, not the last: the
 * slugs use hyphens, so the first underscore is the separator, and cutting at
 * the last one destroyed an activity id in US-054's first run.
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
 * post. Only the first is identity, and it keeps its shape — the second is the
 * id question 2 exists to answer, and destroying it would answer it wrongly.
 */
function scrubUrn(value, pseudonym) {
  const match = value.match(/^urn:li:(person|member|fsd_profile|organization|company):(.+)$/i);
  if (!match) return undefined;

  const [, kind, id] = match;
  return `urn:li:${kind}:${pseudonym(id)}`;
}

/**
 * A LinkedIn member id, wherever it appears in a string.
 *
 * `ACoAACv_mOsBL7o00WlgrCRxmNlVL7Uo1UdQxco` names one person for as long as
 * that account exists. This provider puts it in three places the first run
 * missed: `author.id`, `author.profileId`, and inside the query string of the
 * author's profile URL as `miniProfileUrn=urn:li:fsd_profile:<id>`. It is also
 * on every profile mentioned inside a post's text.
 *
 * Matching the id's own format rather than the field names it arrives under is
 * what makes this hold when the provider renames something. A field list can
 * only cover what somebody has already seen.
 */
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
          if (identityFields.has(key) && (childIsPerson || key !== "name")) {
            return [key, pseudonym(child)];
          }
          if (identityUrlFields.has(key)) {
            return [key, `https://scrubbed.invalid/${pseudonym(child)}`];
          }
          if (personalTextFields.has(key) && childIsPerson) return [key, scrubbedText];
          if (childIsPerson && isMediaUrl(child)) {
            return [key, `https://scrubbed.invalid/${pseudonym(child)}`];
          }

          // Before the URL rules, not after: a member id hides in the query
          // string of a profile URL, and `scrubLinkedInUrl` keeps the tail
          // whole so that a post URL keeps its activity id.
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

async function call(path, { method = "GET", body, token = apiToken } = {}) {
  const startedAt = Date.now();

  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The run object once its bill has stopped moving.
 *
 * Apify charges a pay-per-event actor after the run finishes, so the number is
 * not final at the moment the status changes. This polls until it stops
 * growing, and gives up rather than looping for ever — an unsettled bill is
 * something to report, not to hang on.
 */
async function settledRun(runId, fallback) {
  let previous = fallback.usageTotalUsd ?? 0;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(2000);
    const polled = await call(`/actor-runs/${runId}`);
    const run = polled.body?.data;
    if (!run) continue;

    const usd = run.usageTotalUsd ?? 0;
    if (usd > 0 && usd === previous) return run;
    previous = usd;
  }

  return fallback;
}

// ------------------------------------------------------------- capturing

const written = [];
const ledger = [];
const answers = new Map();

/**
 * Start a run, wait for it, and read its dataset.
 *
 * The asynchronous flow the connector would have to use, rather than the
 * `run-sync-get-dataset-items` shortcut: that endpoint returns the items and
 * not the run, and the run is where `chargedEventCounts` lives. A capture that
 * could not say what it spent would fail its own ticket.
 */
async function runActor(name, input) {
  console.log(`\n${name}`);
  console.log(`  input ${JSON.stringify(input)}`);

  const started = await call(`/acts/${actor}/runs`, { method: "POST", body: input });

  if (started.status >= 400) {
    console.log(`  ${started.status} starting the run`);
    save(name, { httpStatus: started.status, body: started.body }, { input, phase: "start" });
    ledger.push({ run: name, httpStatus: started.status, note: "the run never started" });
    return undefined;
  }

  const runId = started.body?.data?.id;
  const datasetId = started.body?.data?.defaultDatasetId;
  const startedAt = Date.now();

  let run = started.body.data;

  while (Date.now() - startedAt < runTimeoutMs) {
    await sleep(pollIntervalMs);
    const polled = await call(`/actor-runs/${runId}`);
    run = polled.body?.data ?? run;

    process.stdout.write(`\r  ${run.status} after ${Math.round((Date.now() - startedAt) / 1000)}s`);
    if (run.status !== "RUNNING" && run.status !== "READY") break;
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(`\n  ${run.status} in ${(elapsedMs / 1000).toFixed(1)}s`);

  const items = await call(`/datasets/${datasetId}/items`);
  const records = Array.isArray(items.body) ? items.body : [];

  // What the run cost, read after the bill has settled rather than at the
  // moment the run stopped.
  //
  // **The first run of this script got this wrong, and it matters more than a
  // wrong number in a ledger.** A run that had just returned ten posts
  // reported `usageTotalUsd: 0.00005` — the actor's start event and nothing
  // else. Waiting and asking again gave $0.02005, which is ten posts at the
  // published $0.002 plus that start. A budget guard fed the first number
  // would count every poll as costing five thousandths of a cent and would
  // never refuse anything.
  const settled = await settledRun(runId, run);
  const charged = settled.chargedEventCounts ?? {};
  const usd = settled.usageTotalUsd ?? null;
  run = settled;

  ledger.push({
    run: name,
    input,
    runId,
    status: run.status,
    elapsedMs,
    itemsReturned: records.length,
    chargedEventCounts: charged,
    chargedTotalUsd: run.chargedTotalUsd ?? null,
    usageTotalUsd: usd,
  });

  console.log(
    `  ${records.length} items, charged ${JSON.stringify(charged)}, $${usd ?? "(not reported)"}`,
  );

  answers.set(name, { records, run, elapsedMs });
  save(name, records, { input, runId, elapsedMs, phase: "dataset" });

  return { records, run };
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

// ------------------------------------------------------------ describing

/**
 * Every date in one item, whatever the field is called and however deep it is.
 *
 * One level of nesting, because this provider puts the timestamp inside an
 * object: `postedAt: { timestamp, date, postedAgoShort, postedAgoText }`. The
 * first run scanned top-level strings only and reported that the answer had no
 * dates at all, which is a fact about the instrument and not about the
 * provider.
 */
function datesIn(item, prefix = "", depth = 0) {
  const found = [];

  for (const [key, value] of Object.entries(item)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value) && depth < 2) {
      found.push(...datesIn(value, path, depth + 1));
      continue;
    }

    if (typeof value !== "string") continue;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) continue;

    const year = parsed.getUTCFullYear();
    if (year < 2004 || year > 2100) continue;

    found.push({ field: path, at: parsed.toISOString() });
  }

  return found;
}

/** Whichever date field the most items carry, so one field describes the run. */
function primaryDateField(items) {
  const counts = new Map();

  for (const item of items) {
    for (const { field } of datesIn(item)) counts.set(field, (counts.get(field) ?? 0) + 1);
  }

  let best = null;
  for (const [field, count] of counts) if (!best || count > best.count) best = { field, count };

  return best;
}

/** The activity id, wherever this provider chose to put it. */
function activityIdOf(item) {
  const fromUrl = Object.values(item)
    .filter((value) => typeof value === "string")
    .map((value) => value.match(/(?:-activity-|urn:li:activity:)(\d+)/)?.[1])
    .find(Boolean);

  if (fromUrl) return fromUrl;

  const bare = [item.id, item.postId, item.urn].find(
    (value) => typeof value === "string" && /^\d{15,}$/.test(value),
  );

  return bare;
}

function describe(name) {
  const answer = answers.get(name);
  if (!answer) return null;

  const items = answer.records;
  const date = primaryDateField(items);

  const dates = date
    ? items
        .map((item) => datesIn(item).find((entry) => entry.field === date.field)?.at ?? null)
        .filter((value) => value !== null)
    : [];

  const sorted = [...dates].sort();

  return {
    run: name,
    status: answer.run.status,
    elapsedMs: answer.elapsedMs,
    itemCount: items.length,
    itemKeys: items[0] ? Object.keys(items[0]) : [],
    dateField: date?.field ?? null,
    newest: sorted.at(-1) ?? null,
    oldest: sorted[0] ?? null,
    orderedNewestFirst:
      dates.length > 1 && dates.every((value, index) => index === 0 || value <= dates[index - 1]),
    activityIds: items.map((item) => activityIdOf(item) ?? null),
    /** Question 9: are comments in the answer without being asked for? */
    carriesComments: items.some((item) => Array.isArray(item.comments) && item.comments.length > 0),
    chargedEventCounts: answer.run.chargedEventCounts ?? {},
    usageTotalUsd: answer.run.usageTotalUsd ?? null,
  };
}

// ---------------------------------------------------------------- the run

const only = process.argv
  .filter((argument) => argument.startsWith("--only="))
  .map((argument) => argument.slice("--only=".length));

/**
 * Rewrite the fixtures from the runs already recorded in `manifest.json`,
 * buying nothing.
 *
 * A dataset outlives its run on Apify, so a scrubber that let something
 * through can be fixed and the same answers re-scrubbed for free. That is the
 * difference between reading your fixtures before committing them and paying
 * to read them: the first run of this script leaked an author's headline and
 * destroyed every post URL, and neither cost a second run to put right.
 */
const rescrub = process.argv.includes("--rescrub");

const wanted = (name) =>
  !rescrub && (only.length === 0 || only.some((part) => name.includes(part)));

if (rescrub) {
  console.log("Re-reading the datasets already captured. This buys nothing.\n");

  const manifest = JSON.parse(readFileSync(`${here}manifest.json`, "utf8"));

  for (const entry of manifest.files) {
    const runId = entry.request?.runId;

    // A file with no run behind it — the refused-token probe — is carried
    // forward rather than dropped. A manifest that quietly lost a fixture
    // would be a record with a hole in it.
    if (!runId) {
      written.push(entry);
      continue;
    }

    const name = entry.file.replace(/\.json$/, "");
    console.log(name);

    const polled = await call(`/actor-runs/${runId}`);
    const run = polled.body?.data;
    if (!run) {
      console.log("  the run is gone; leaving this fixture as it is");
      continue;
    }

    const items = await call(`/datasets/${run.defaultDatasetId}/items`);
    const records = Array.isArray(items.body) ? items.body : [];

    ledger.push({
      run: name,
      input: entry.request.input,
      runId,
      status: run.status,
      elapsedMs: null,
      itemsReturned: records.length,
      chargedEventCounts: run.chargedEventCounts ?? {},
      chargedTotalUsd: run.chargedTotalUsd ?? null,
      usageTotalUsd: run.usageTotalUsd ?? null,
    });

    console.log(`  ${records.length} items, $${run.usageTotalUsd ?? "(not reported)"} settled`);

    answers.set(name, { records, run, elapsedMs: entry.request.elapsedMs ?? null });
    save(name, records, entry.request);
  }
}

if (!rescrub) {
  console.log("Asking HarvestAPI about LinkedIn. This spends Apify credit.");
  console.log(`A post is $0.002 on the FREE plan. Each search run asks for ${maxPosts}.`);
}

/** Question 7: what a refused token says, and whether it reached the account. */
if (wanted("credentials")) {
  console.log("\ncredentials-rejected");
  const refused = await call(`/acts/${actor}/runs`, {
    method: "POST",
    body: { searchQueries: [keyword], maxPosts },
    token: "not-a-real-token",
  });

  console.log(`  ${refused.status} in ${refused.elapsedMs} ms`);
  ledger.push({
    run: "credentials-rejected",
    httpStatus: refused.status,
    note: "sent with a deliberately invalid token; no run should have started",
  });
  save(
    "credentials-rejected",
    { httpStatus: refused.status, body: refused.body },
    { phase: "start", note: "invalid token" },
  );
}

/** Questions 1, 2, 3, 4 and 8. The run everything else is compared against. */
if (wanted("search")) {
  await runActor("search-by-date", {
    searchQueries: [keyword],
    maxPosts,
    sortBy: "date",
  });
}

/** Question 5: does the window narrow the answer? */
if (wanted("window")) {
  await runActor("search-past-week", {
    searchQueries: [keyword],
    maxPosts,
    sortBy: "date",
    postedLimit: "week",
  });
}

/** Question 6: what a query matching nothing returns, and what it costs. */
if (wanted("empty")) {
  await runActor("search-no-results", {
    searchQueries: [impossible],
    maxPosts,
    sortBy: "date",
  });
}

// ------------------------------------------------------------ the answers

const findings = {
  note:
    "US-056. What HarvestAPI's LinkedIn post search returns and what it costs, " +
    "computed from the runs in this folder.",
  capturedAt: new Date().toISOString(),
  plan: "FREE",
  runs: [...answers.keys()].map(describe).filter((entry) => entry !== null),
};

const search = findings.runs.find((entry) => entry.run === "search-by-date");

if (search) {
  const ids = search.activityIds.filter(Boolean);

  findings.summary = {
    postsReturned: search.itemCount,
    secondsPerRun: Number((search.elapsedMs / 1000).toFixed(1)),
    sortedNewestFirst: search.orderedNewestFirst,
    newestPost: search.newest,
    oldestPost: search.oldest,
    activityIdsFound: ids.length,
    activityIdsDistinct: new Set(ids).size,
    carriesCommentsUnasked: search.carriesComments,
    chargedEventCounts: search.chargedEventCounts,
    usageTotalUsd: search.usageTotalUsd,
  };

  // The number US-053 is turning LinkedIn off over, on this account's plan.
  // A post is 2,000 micro-dollars on FREE and 1,500 on GOLD and above.
  if (search.itemCount > 0) {
    findings.summary.dollarsPerFiftyPostsFreePlan = 0.002 * 50;
    findings.summary.dollarsPerFiftyPostsGoldPlan = 0.0015 * 50;
  }
}

const totalUsd = ledger.reduce((sum, entry) => sum + (entry.usageTotalUsd ?? 0), 0);

writeFileSync(`${here}findings.json`, `${JSON.stringify(findings, null, 2)}\n`);

/**
 * Keep what an earlier pass recorded, and replace only what this one redid.
 *
 * A partial run — `--only=credentials`, or a `--rescrub` of the runs that have
 * datasets — used to rewrite the whole record and silently drop every entry it
 * had not touched. A manifest with a hole in it cannot answer where a payload
 * came from, which is the one thing it exists for.
 */
function mergedBy(key, existingPath, fresh) {
  let existing = [];
  try {
    existing = JSON.parse(readFileSync(existingPath, "utf8"))[key] ?? [];
  } catch {
    existing = [];
  }

  const name = (entry) => entry.file ?? entry.run;
  const redone = new Set(fresh.map(name));

  return [...existing.filter((entry) => !redone.has(name(entry))), ...fresh];
}

const allFiles = mergedBy("files", `${here}manifest.json`, written);
const allRuns = mergedBy("runs", `${here}ledger.json`, ledger);

writeFileSync(
  `${here}manifest.json`,
  `${JSON.stringify(
    {
      note:
        "Which run produced each file. Captured from the live API; see " +
        "docs/testing.md on why these are captured and never written.",
      provider: "apify",
      actor: "harvestapi/linkedin-post-search",
      platform: "linkedin",
      files: allFiles,
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
        "What each run was charged, in the provider's own numbers. Prices are " +
        "tiered by Apify plan; this account is on FREE, where a post is $0.002 " +
        "and a zero-result query is $0.001.",
      totalUsd: Number(totalUsd.toFixed(5)),
      runs: allRuns,
    },
    null,
    2,
  )}\n`,
);

console.log("\n---");
console.log(
  `wrote ${written.length} fixtures, and merged them into findings.json, manifest.json and ledger.json`,
);
console.log(
  rescrub
    ? `the runs re-read cost $${totalUsd.toFixed(5)} when they were made; this pass bought nothing`
    : `the run spent $${totalUsd.toFixed(5)}`,
);

if (findings.summary) {
  const s = findings.summary;
  console.log(
    [
      "",
      `posts returned      ${s.postsReturned}`,
      `run took            ${s.secondsPerRun}s`,
      `sorted by date      ${s.sortedNewestFirst ? "yes, newest first" : "no"}`,
      `newest post         ${s.newestPost ?? "(no date field found)"}`,
      `oldest post         ${s.oldestPost ?? "(no date field found)"}`,
      `activity ids        ${s.activityIdsFound} of ${s.postsReturned}, ${s.activityIdsDistinct} distinct`,
      `comments unasked    ${s.carriesCommentsUnasked ? "yes" : "no"}`,
      `charged             ${JSON.stringify(s.chargedEventCounts)}`,
      `fifty posts cost    $${s.dollarsPerFiftyPostsFreePlan} on FREE, $${s.dollarsPerFiftyPostsGoldPlan} on GOLD`,
    ].join("\n"),
  );
}

console.log("\nRead the fixtures before committing them. US-028's first run leaked real names.");
