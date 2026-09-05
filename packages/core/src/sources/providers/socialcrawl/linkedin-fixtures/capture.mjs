#!/usr/bin/env node
/**
 * Capture the SocialCrawl payloads the LinkedIn connector parses.
 *
 * docs/testing.md: a fixture for someone else's API is captured, never
 * written. So this script exists before the parser does, and it stays
 * committed and re-runnable, because the next person to touch the parser needs
 * to be able to ask the provider again.
 *
 * It sits in its own folder rather than beside the X fixtures, and the reason
 * is a hazard rather than tidiness: two capture scripts writing one
 * `manifest.json` means a full run of either erases the other's record of
 * where its payloads came from.
 *
 * US-028 reached LinkedIn through the provider that already fetches X, so
 * there is no elimination story here and none is claimed. Bright Data and
 * ScrapeCreators were never asked about LinkedIn. What the provider's
 * documentation says about `GET /v1/linkedin/search/posts` is three claims —
 * 5 credits, no pagination, best-effort coverage — and this script is how each
 * of them stops being a claim.
 *
 * Nine questions the documentation cannot settle:
 *
 *   1. What is one post on the wire? Every field the parser will read, and the
 *      ones it will not, because a fixture trimmed to today's parser stops
 *      being evidence tomorrow.
 *   2. Does the answer report `credits_used`, and is it really 5? The X
 *      endpoint reports it on every answer. The budget guard is fed this
 *      number, so it is measured and never assumed.
 *   3. Is there a cursor? The documentation names none, and a search with one
 *      window per query is a different connector from one that pages. This
 *      script does not look for a documented field; it walks the whole answer
 *      and reports every key that could be one.
 *   4. Which `date_posted` values exist, and does the parameter narrow the
 *      window? A monitor asks for what was said since it last looked. On X
 *      that is an operator inside the query; here the documentation names a
 *      parameter, and a parameter that is ignored costs a poll its whole
 *      history every time.
 *   5. Which `content_type` values exist? The documentation names the
 *      parameter and not its values. An invalid one is the cheapest way to
 *      make a provider list the valid ones — it answered exactly that way for
 *      `sort` on the X endpoint.
 *   6. What does a refused key say, and with what status? A refusal and an
 *      outage lead to different actions, so the connector needs the real one.
 *   7. Is a credential probe free? The X probe was, measured twice. That is a
 *      fact about one endpoint and not about this one.
 *   8. Does a search that finds nothing still bill? SocialCrawl refunded an
 *      empty X search and ScrapeCreators charges for an empty Reddit one, so
 *      there is no safe assumption to make here.
 *   9. Does a long phrase find anything? US-006 measured X's four-word ceiling
 *      by running a long query and a short one against the live API. A
 *      LinkedIn post is long-form, so the plausible answer is that a long
 *      phrase works — and plausible is not measured. The same query is sent
 *      twice, long and short, and the two answers set `maxQueryWords`.
 *
 * A tenth thing falls out of question 9 for free: `search-repeat` sends the
 * same query again, so the ids can be compared across two calls. Deduplication
 * rests on an id that is stable between polls, and nothing else here proves
 * that it is.
 *
 * Run it with your own key. The default run makes five billed calls at 5
 * credits each, plus four probes that are expected to be free:
 *
 *     node packages/core/src/sources/providers/socialcrawl/linkedin-fixtures/capture.mjs
 *     node .../capture.mjs --only=search
 *     node .../capture.mjs --only=member    # not in the default run; see below
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

const api = "https://www.socialcrawl.dev/v1/linkedin";

/**
 * The endpoint a monitor needs: keyword discovery across public LinkedIn
 * posts.
 *
 * Read from the provider's documentation on 2026-09-05. It is a claim this run
 * tests, not a fact it trusts.
 */
const endpoints = {
  searchPosts: `${api}/search/posts`,
};

/**
 * The query a monitor would generate: somebody describing a problem, not
 * naming a product. It is the same keyword US-022 ran through Bright Data,
 * US-025 through ScrapeCreators and US-006 through SocialCrawl's X endpoint,
 * so a fourth answer joins a comparison that already has three.
 */
const keyword = "end to end tests keep breaking";

/**
 * The short form of the same question.
 *
 * On X the long phrase returned anime and Bitcoin unquoted, and nothing at all
 * quoted, while these two words returned twenty posts that were all on topic.
 * A LinkedIn post is long-form, so the expectation is the opposite result.
 * Running both is what turns the expectation into a measurement, and the pair
 * is what sets the platform's `maxQueryWords`.
 */
const shortKeyword = "flaky tests";

/**
 * A member and a company, for the discovery mode that names an account rather
 * than a topic.
 *
 * These are behind `--only` and out of the default run on purpose. The
 * documentation names `from_member` and `from_company` and does not say what
 * they take — a URL, a slug or an urn — and a wrong guess costs 5 credits to
 * learn nothing. Run this group deliberately, with a value you have checked.
 */
const member = process.env.CAPTURE_LINKEDIN_MEMBER ?? "williamhgates";
const company = process.env.CAPTURE_LINKEDIN_COMPANY ?? "github";

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
      "One SocialCrawl key serves every platform that provider fetches, so this",
      "is the same key the X connector uses. Get one at https://www.socialcrawl.dev.",
    ].join("\n"),
  );
  process.exit(1);
}

// ------------------------------------------------------------- scrubbing

/**
 * Fields that name a person or a company, wherever they appear.
 *
 * They are replaced, not deleted: the parser has to keep seeing a value of the
 * right kind where the provider puts one, and a fixture missing a key agrees
 * with a parser that forgot to read it. The same real value maps to the same
 * pseudonym inside one run, so a payload referring to one author twice still
 * does after scrubbing.
 *
 * The list is wider than the fields we parse. LinkedIn is a professional
 * network, so an answer carries employers, job titles and locations that the
 * connector will never read and that we have no business committing.
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
 * `title` is deliberately absent, and the first run is why. On this endpoint
 * an item's `title` holds the whole post text — the one field the classifier
 * reads. A rule that scrubbed it would leave a fixture that agrees with any
 * parser at all.
 */
const personalTextFields = new Set([
  "headline",
  "description",
  "bio",
  "summary",
  "location",
  "occupation",
  "job_title",
]);

const scrubbedText = "Scrubbed by capture.mjs. See docs/testing.md.";

/**
 * A key whose value is a whole person, however that person is described.
 *
 * The first run of this script committed real names and real job headlines,
 * because it decided what a person was by sniffing for fields — `headline`,
 * `public_identifier` — that this provider does not use. It puts a person
 * under `author` as `{ name, description, url, avatar }`, and none of those
 * four tripped the rule.
 *
 * Naming the container instead of guessing at its contents is the fix. Every
 * key below carries a person or an organisation, so everything under it is
 * identity until proven otherwise, whatever the provider renames its fields to
 * next.
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
 * it is scrubbed only inside an object that already looks like a person. A
 * blanket rule would rewrite a field the parser reads and turn the fixture
 * into a record of this script.
 */
function looksLikeAPerson(value) {
  return ["headline", "public_identifier", "profile_url", "first_name", "vanity_name"].some(
    (key) => key in value,
  );
}

/**
 * A profile photo is identity, and it does not arrive on a linkedin.com URL.
 *
 * The avatars in the first run were `media.licdn.com` links carrying a signed
 * token, nested inside an array of four sizes. Scrubbing by field name missed
 * every one of them, so the host is checked instead — but only inside a
 * person, because a post's own image sits on the same host and is not
 * identity.
 */
function isMediaUrl(value) {
  return /^https?:\/\/[^/]*licdn\.com\//i.test(value);
}

/**
 * A LinkedIn URL carries identity in its path, and the post URL is the worst
 * case: `linkedin.com/posts/<person-slug>_<activity-id>` puts somebody's name
 * in front of the one part the parser reads.
 *
 * So the slug is pseudonymised and the activity id is kept whole. Dropping the
 * whole URL would delete the field the connector stores; keeping it would put
 * back exactly what the field scrubbing takes out.
 */
function scrubLinkedInUrl(value, pseudonym) {
  const match = value.match(
    /^(https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com)\/([^/?#]+)\/([^?#]*)(.*)$/i,
  );
  if (!match) return undefined;

  const [, origin, section, rest, tail] = match;

  // linkedin.com/posts/<slug>_<activity id>: keep the id, replace the name.
  if (section === "posts" || section === "pulse") {
    const cut = rest.lastIndexOf("_");
    const activity = cut === -1 ? "" : rest.slice(cut);
    const slug = cut === -1 ? rest : rest.slice(0, cut);
    return `${origin}/${section}/${pseudonym(slug)}${activity}${tail}`;
  }

  // linkedin.com/in/<slug>, /company/<slug>, /school/<slug>: all identity.
  if (["in", "company", "school", "showcase"].includes(section)) {
    const [first, ...after] = rest.split("/");
    return `${origin}/${section}/${pseudonym(first)}${after.length ? `/${after.join("/")}` : ""}${tail}`;
  }

  return undefined;
}

/**
 * `urn:li:person:ABC123` names one person, and `urn:li:activity:123` names one
 * post. The first is identity and the second is the id deduplication may rest
 * on, so only the first is replaced — and it keeps its shape, in case the
 * parser reads one.
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

        // A person's fields stay a person's fields all the way down: an author
        // holds an avatar list, and each entry of that list holds a URL that
        // names the same person.
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
 * captured too. The connector has to tell a user whose key is wrong from a
 * user whose query found nothing, and it can only do that against the real
 * refusal.
 */
async function request(url, { key = apiKey } = {}) {
  const startedAt = Date.now();

  const response = await fetch(url, { headers: { "x-api-key": key } });
  const text = await response.text();

  // Not every answer is JSON. Bright Data's invalid key replies with a bare
  // string, and there is no reason to assume this endpoint is stricter than
  // its sibling. Keep it as the string it was on the wire.
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

/** What the account had left, if the provider says so. */
function creditsRemaining(body) {
  const value = body?.credits_remaining;
  return typeof value === "number" ? value : undefined;
}

function creditsUsed(body) {
  const value = body?.credits_used;
  return typeof value === "number" ? value : undefined;
}

/**
 * Whether the provider answered from its own cache.
 *
 * The first run found this by accident: the same query sent twice came back in
 * a fifth of the time, flagged `cached: true`, and charged nothing. A
 * connector cannot rely on that — the flag is the provider's, the window is
 * not documented, and a cap must be sized on the price of a call that is
 * really made.
 */
function cached(body) {
  const value = body?.cached;
  return typeof value === "boolean" ? value : undefined;
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
 * hole in it cannot answer "was the probe billed?" or "is a request really 5
 * credits?", and both are acceptance boxes on US-028.
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
    // The provider says whether it answered from its own cache, and a cached
    // answer was charged nothing in the first run. That is a fact about
    // somebody's bill, so it belongs in the ledger and not in a comment.
    cached: cached(answer.body) ?? null,
    note: options.note ?? null,
  });

  console.log(
    `  ${answer.status} in ${answer.elapsedMs} ms` +
      `, used ${creditsUsed(answer.body) ?? "(not reported)"}` +
      `, ${creditsRemaining(answer.body) ?? "(not reported)"} left` +
      `${cached(answer.body) ? ", from the provider's cache" : ""}`,
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

/**
 * Every key anywhere in the answer that could be a cursor, with its path.
 *
 * The X client found the cursor in two places and the documented one was not
 * the only one. Here the documentation names none at all, so looking for a
 * field we expect would prove only that we expected it. This walks the whole
 * body instead and reports what is there, which is the honest form of question
 * 3: a connector that pages and one that does not are different connectors.
 */
function cursorCandidates(value, path = "", found = []) {
  if (Array.isArray(value)) {
    // One entry is enough to see the shape; a hundred posts would bury it.
    if (value.length > 0) cursorCandidates(value[0], `${path}[0]`, found);
    return found;
  }

  if (value === null || typeof value !== "object") return found;

  for (const [key, child] of Object.entries(value)) {
    const at = path ? `${path}.${key}` : key;
    const name = key.toLowerCase();

    if (/cursor|next|page|offset|token|has_more/.test(name) && child !== null && child !== "") {
      found.push({ path: at, value: typeof child === "string" ? child.slice(0, 60) : child });
    }

    cursorCandidates(child, at, found);
  }

  return found;
}

/**
 * How many posts an answer carried.
 *
 * The envelope's shape is not known before the first run, so the first list of
 * objects found is the answer rather than a field name typed from a
 * documentation page.
 */
function itemsIn(body) {
  if (Array.isArray(body?.data?.items)) return body.data.items;
  if (Array.isArray(body?.data?.posts)) return body.data.posts;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.posts)) return body.posts;
  if (Array.isArray(body?.results)) return body.results;
  return undefined;
}

/** Whatever each item calls its id, for the deduplication question. */
function idsIn(body) {
  const items = itemsIn(body);
  if (!items) return [];

  return items.map((item) => {
    const post = item?.post ?? item;
    return post?.id ?? post?.urn ?? post?.activity_urn ?? post?.url ?? undefined;
  });
}

// ---------------------------------------------------------------- the run

const only = process.argv
  .filter((argument) => argument.startsWith("--only="))
  .map((argument) => argument.slice("--only=".length));

const wanted = (name) => only.length === 0 || only.some((part) => name.includes(part));

console.log("Capturing SocialCrawl LinkedIn payloads. This spends credits from your allowance.");
console.log("The documentation prices this endpoint at 5 credits a call. The ledger says.");

/**
 * The two answers a credential check can get.
 *
 * The rejected one is sent with a key that cannot be real. The accepted one is
 * the cheapest request that still proves the key got past authentication — a
 * search with no `query`, which the provider must refuse on the input rather
 * than on the key. Whether either is free is not assumed here; the ledger
 * says. This matters more on this endpoint than on the X one: a probe billed
 * at 5 credits is a settings screen that charges a person for typing their key
 * correctly.
 */
if (wanted("credentials")) {
  await capture(
    "credentials-rejected",
    endpoints.searchPosts,
    { query: shortKeyword },
    { key: "this-key-is-not-real", note: "sent with a deliberately invalid key" },
  );

  await capture(
    "credentials-accepted",
    endpoints.searchPosts,
    {},
    { note: "a working key with no query: refused on the input, not on the key" },
  );
}

/**
 * Two invalid parameter values, to make the provider list the valid ones.
 *
 * The documentation names `past_24h`, `past_week` and `past_month` for
 * `date_posted`, and names no values at all for `content_type`. Asking this
 * way cost nothing on the X endpoint and it is how `sort=latest` was found —
 * a value the documentation did not mention.
 */
if (wanted("rejected")) {
  await capture(
    "date-rejected",
    endpoints.searchPosts,
    { query: shortKeyword, date_posted: "this-is-not-a-window" },
    { note: "an invalid date_posted, to make the provider name the valid ones" },
  );

  await capture(
    "content-type-rejected",
    endpoints.searchPosts,
    { query: shortKeyword, content_type: "this-is-not-a-type" },
    { note: "an invalid content_type; the documentation names no values for it" },
  );
}

/**
 * The search itself: the long phrase, then the short one.
 *
 * This is question 9, and the pair is the measurement. On X the long phrase
 * lost to two words and the platform's ceiling was set at four. A LinkedIn
 * post has paragraphs, so the expected answer is different — and an expected
 * answer that is never run is how a number gets into a descriptor with nothing
 * behind it.
 */
if (wanted("search")) {
  const long = await capture(
    "search-posts",
    endpoints.searchPosts,
    { query: keyword },
    { note: `the long phrase (${keyword.split(" ").length} words), as the generator writes them` },
  );

  const short = await capture(
    "search-short-query",
    endpoints.searchPosts,
    { query: shortKeyword },
    { note: `the same question in ${shortKeyword.split(" ").length} words` },
  );

  const longCount = itemsIn(long.body)?.length;
  const shortCount = itemsIn(short.body)?.length;
  console.log(`\n  long query: ${longCount ?? "(no list found)"} posts`);
  console.log(`  short query: ${shortCount ?? "(no list found)"} posts`);

  if (longCount === undefined && shortCount === undefined) {
    failures.push(
      "search: no list of posts was found in either answer. Read search-posts.json " +
        "and teach itemsIn() what the envelope really calls its items.",
    );
  }

  const cursors = cursorCandidates(long.body);
  console.log(`\n  cursor candidates in search-posts.json: ${cursors.length}`);
  for (const candidate of cursors) console.log(`    ${candidate.path} = ${candidate.value}`);

  /**
   * The second page, which the documentation says does not exist.
   *
   * The first run found `pagination.next_cursor` and `pagination.has_more`
   * anyway. A cursor we never followed is a cursor we have not tested, and the
   * whole deduplication story rests on it: if page two repeats page one, every
   * poll pays 5 credits for posts it already holds.
   */
  const cursor = long.body?.pagination?.next_cursor;

  if (typeof cursor === "string" && cursor !== "") {
    const second = await capture(
      "search-page-2",
      endpoints.searchPosts,
      { query: keyword, cursor },
      { note: "followed pagination.next_cursor from search-posts.json" },
    );

    const firstPage = idsIn(long.body).filter(Boolean);
    const secondPage = idsIn(second.body).filter(Boolean);
    const repeated = secondPage.filter((id) => firstPage.includes(id));
    console.log(
      `\n  page 2: ${secondPage.length} posts, ${repeated.length} of them also on page 1`,
    );

    if (secondPage.length > 0 && repeated.length === secondPage.length) {
      failures.push(
        "page 2: every post on page two was already on page one. Either the cursor " +
          "parameter is not called `cursor`, or paging does not work on this endpoint.",
      );
    }
  } else {
    failures.push(
      "page 2: no cursor at pagination.next_cursor, so page two was not captured. " +
        "Read search-posts.json and find what the cursor is really called.",
    );
  }

  /**
   * The same query again, unchanged.
   *
   * Two calls, two id lists, and deduplication rests on their overlap. If the
   * provider hands back a different id for the same post between two calls,
   * every poll stores the whole page again and no cap in this product can
   * hold.
   */
  const repeat = await capture(
    "search-repeat",
    endpoints.searchPosts,
    { query: keyword },
    { note: "the same query as search-posts.json, to compare ids across two calls" },
  );

  const first = idsIn(long.body).filter(Boolean);
  const again = idsIn(repeat.body).filter(Boolean);
  const shared = first.filter((id) => again.includes(id));
  console.log(
    `\n  ids: ${first.length} then ${again.length}, ${shared.length} the same across both calls`,
  );

  if (first.length > 0 && shared.length === 0) {
    failures.push(
      "search: no id appeared in both calls of the same query. Either the ids are " +
        "not stable, or idsIn() is reading the wrong field. Deduplication depends on this.",
    );
  }
}

/**
 * The date window, which here is a parameter rather than an operator.
 *
 * A monitor asks for what was said since it last looked. If the parameter is
 * honoured, `since` costs nothing extra. If it is accepted and ignored, every
 * poll pays 5 credits for the whole history and the connector has to filter by
 * date itself, the way the ScrapeCreators Reddit connector already does.
 */
if (wanted("window")) {
  await capture(
    "search-past-week",
    endpoints.searchPosts,
    { query: shortKeyword, date_posted: "past_week" },
    { note: "date_posted=past_week; compare the oldest post here with search-short-query.json" },
  );
}

/**
 * A query that cannot match anything.
 *
 * This is not a refusal, and that is the point of capturing it. SocialCrawl
 * refunded the empty X search and ScrapeCreators bills for a subreddit that
 * does not exist. At 5 credits a call, a monitor with a dead query is either
 * free or the most expensive way in this product to receive nothing.
 */
if (wanted("empty")) {
  await capture(
    "search-no-results",
    endpoints.searchPosts,
    { query: "intentwatch-no-such-phrase-9a3f7c21" },
    { note: "a phrase that cannot match; does it answer 200 and bill 5 credits for it?" },
  );
}

/**
 * The discovery mode that names an account rather than a topic.
 *
 * Out of the default run: the documentation names `from_member` and
 * `from_company` without saying whether they take a URL, a slug or an urn, and
 * a wrong guess costs 5 credits and teaches nothing. Set
 * CAPTURE_LINKEDIN_MEMBER or CAPTURE_LINKEDIN_COMPANY and ask for this group
 * deliberately.
 */
if (only.length > 0 && wanted("member")) {
  await capture(
    "search-from-member",
    endpoints.searchPosts,
    { query: shortKeyword, from_member: member },
    { note: `from_member=${member}, given as a public identifier` },
  );
}

if (only.length > 0 && wanted("company")) {
  await capture(
    "search-from-company",
    endpoints.searchPosts,
    { query: shortKeyword, from_company: company },
    { note: `from_company=${company}, given as a public identifier` },
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
      capturedBy: "packages/core/src/sources/providers/socialcrawl/linkedin-fixtures/capture.mjs",
      provider: "SocialCrawl, LinkedIn API v1",
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
        "evidence for the billable unit, for the 5-credit price the documentation " +
        "claims, and for whether a credential probe is free.",
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
