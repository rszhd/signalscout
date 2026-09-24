#!/usr/bin/env node
/**
 * Ask HarvestAPI's own API what a LinkedIn search returns and what it costs.
 *
 * US-386. Apify runs HarvestAPI's actor for us and bills a post; the direct API
 * bills a request, which is one page of results. The ticket's Context holds the
 * price table. This script answers the eight questions the ticket lists, in
 * the ticket's order, and a connector is written from what it finds.
 *
 * The rules for a capture are in docs/sources.md, *Capturing one, in order*.
 *
 * Run it with your own key, read from `.env` or the environment, never from
 * the command line:
 *
 *     node packages/engine/src/sources/providers/harvestapi/linkedin-fixtures/capture.mjs
 *     node .../capture.mjs --only=search
 *     node .../capture.mjs --only=comments
 *     node .../capture.mjs --rescrub        # re-scrub the last raw answers, buying nothing
 *
 * **Cost.** Five paid requests: three searches, one empty search and one
 * comment page. At the Starter price of $0.004 a request that is $0.02. The
 * rejected key and the account read are expected to be free; the ledger
 * records the balance either side of every call, so that claim is measured.
 *
 * What it writes, into this folder:
 *
 *   <name>.json     the answer, with author identity scrubbed
 *   manifest.json   which request produced each file
 *   ledger.json     what each request moved the balance by
 *   findings.json   the answers to the ticket's questions, computed
 *
 * The unscrubbed answers go to the system temporary folder, never here, so
 * that a scrubber fixed after a run can be re-applied without buying the
 * answers twice.
 *
 * **Read the fixtures before committing them.** The scrubber is the Apify
 * capture's, because the upstream is the same; that makes it likely and not
 * certain to hold.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));
const rawDir = join(tmpdir(), "signalscout-harvestapi-linkedin-raw");

const api = "https://api.harvestapi.io";

/** The query every earlier LinkedIn capture used, so the providers compare. */
const keyword = "flaky tests";

/** A phrase that cannot occur, for question 3. */
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

const rescrub = process.argv.includes("--rescrub");

const apiKey = process.env.HARVESTAPI_API_KEY || readEnvFile(`${root}.env`).HARVESTAPI_API_KEY;

if (!apiKey && !rescrub) {
  console.error(
    [
      "No HarvestAPI key. Set HARVESTAPI_API_KEY in .env, or in the environment.",
      "",
      "Create one at https://harvestapi.io/admin/api-keys. It needs no LinkedIn",
      "account of your own.",
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
    // `posts/activity-<id>-<hash>` names no person, and the direct API sends
    // it. Pseudonymising it whole destroyed the activity id (US-386).
    if (rest.startsWith("activity-")) return value;
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

  /**
   * A name written into a comment by a mention.
   *
   * US-159's first comment capture committed a real name: the actor marks a
   * `PROFILE_MENTION` in `commentaryAttributes` with a `start` and a `length`
   * into `commentary`, scrubs nothing, and the attribute rules above replaced
   * the profile beside the span while the span itself stayed. The words are
   * the text this product classifies, so only the named span is replaced —
   * from the end backwards, so earlier offsets stay true while later ones
   * are rewritten.
   */
  function scrubMentionedNames(text, attributes) {
    if (typeof text !== "string" || !Array.isArray(attributes)) return text;

    const spans = attributes
      .filter((attribute) => attribute?.type === "PROFILE_MENTION")
      .filter(
        (attribute) => Number.isInteger(attribute.start) && Number.isInteger(attribute.length),
      )
      .sort((a, b) => b.start - a.start);

    // Code points, not UTF-16 units: LinkedIn counts `start` and `length` in
    // code points. On a post written in styled Unicode letters, slicing the
    // string directly replaced the wrong span and left the name (US-386).
    const points = Array.from(text);
    for (const { start, length } of spans) {
      const name = points.slice(start, start + length).join("");
      if (name.trim() === "") continue;
      points.splice(start, length, pseudonym(name));
    }
    return points.join("");
  }

  /**
   * Every person's name the answer itself carries, longest first.
   *
   * "Follow <name> for more" is common on LinkedIn and carries no mention
   * attribute, so the span rule above never sees it — and on a company page's
   * post the name belongs to somebody who is an author elsewhere in the same
   * answer. The names are taken from the answer's own person containers, never
   * guessed from the words.
   */
  const knownNames = new Set();

  function collectNames(value, insidePerson = false, depth = 0) {
    if (depth > 20 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) collectNames(child, insidePerson, depth + 1);
      return;
    }

    const person = insidePerson;
    if (person) {
      const full = [value.firstName, value.lastName].filter((part) => typeof part === "string");
      for (const name of [value.name, full.join(" ")]) {
        if (typeof name === "string" && name.trim().length >= 3) knownNames.add(name.trim());
      }
    }

    for (const [key, child] of Object.entries(value)) {
      collectNames(child, person || personContainers.has(key), depth + 1);
    }
  }

  function scrubKnownNames(text) {
    if (typeof text !== "string") return text;
    let out = text;
    for (const name of [...knownNames].sort((a, b) => b.length - a.length)) {
      // The joined form too, because a name also arrives as a hashtag.
      for (const form of new Set([name, name.replace(/\s+/g, "")])) {
        if (out.includes(form)) out = out.split(form).join(pseudonym(name));
      }
    }
    // A recruiting post carries a person's work address in its text.
    out = out.replace(
      /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
      (address) => `${pseudonym(address)}@scrubbed.invalid`,
    );
    return out;
  }

  function scrub(value, insidePerson = false) {
    if (Array.isArray(value)) return value.map((child) => scrub(child, insidePerson));
    if (value === null || typeof value !== "object") return value;

    if (typeof value.commentary === "string" && Array.isArray(value.commentaryAttributes)) {
      value = {
        ...value,
        commentary: scrubMentionedNames(value.commentary, value.commentaryAttributes),
      };
    }

    // A post marks its mentions the same way, under `content` and
    // `contentAttributes`. The Apify capture never scrubbed these; US-386's
    // first run showed a mentioned name in a post's text.
    if (typeof value.content === "string" && Array.isArray(value.contentAttributes)) {
      value = {
        ...value,
        content: scrubMentionedNames(value.content, value.contentAttributes),
      };
    }

    if (typeof value.content === "string") {
      value = { ...value, content: scrubKnownNames(value.content) };
    }
    if (typeof value.commentary === "string") {
      value = { ...value, commentary: scrubKnownNames(value.commentary) };
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        const childIsPerson = insidePerson || personContainers.has(key);

        if (typeof child === "string" && child !== "") {
          if (identityFields.has(key) && (childIsPerson || key !== "name")) {
            return [key, pseudonym(child)];
          }
          // A person's own ids. `author.urn` is a bare member number here, so
          // the member-id pattern below never matches it.
          if (childIsPerson && ["id", "urn", "profileId"].includes(key)) {
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

  return {
    scrub: (value) => {
      collectNames(value);
      return scrub(value);
    },
    replaced: () => pseudonyms.size,
  };
}

// ------------------------------------------------------------------ http

async function call(path, params = {}, key = apiKey) {
  const query = new URLSearchParams(params).toString();
  const startedAt = Date.now();

  const response = await fetch(`${api}${path}${query ? `?${query}` : ""}`, {
    headers: { "X-API-Key": key, Accept: "application/json" },
  });

  const text = await response.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { status: response.status, body, elapsedMs: Date.now() - startedAt };
}

/**
 * Every number in the account answer whose name says credit or balance.
 *
 * The shape of `/users/my-api-user` is undocumented, so the fields are found by
 * name rather than assumed. Only numbers are kept: the rest of that answer is
 * the account holder, and nothing about them belongs in a fixture.
 */
function moneyFields(value, prefix = "", depth = 0, out = {}) {
  if (depth > 4 || value === null || typeof value !== "object") return out;

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "number" && /credit|balance|usd|remaining|spent|usage/i.test(key)) {
      out[path] = child;
    } else if (typeof child === "object") {
      moneyFields(child, path, depth + 1, out);
    }
  }

  return out;
}

async function account() {
  const answer = await call("/users/my-api-user");
  return { status: answer.status, money: moneyFields(answer.body) };
}

/** What moved between two account reads, field by field. */
function moved(before, after) {
  const out = {};
  for (const [key, value] of Object.entries(after.money)) {
    const was = before.money[key];
    if (typeof was === "number" && was !== value) out[key] = Number((value - was).toFixed(6));
  }
  return out;
}

// ------------------------------------------------------------- capturing

const written = [];
const ledger = [];
const failures = [];

function saveRaw(name, answer, request) {
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, `${name}.json`), JSON.stringify({ request, answer }));
}

function readRaw(name) {
  try {
    return JSON.parse(readFileSync(join(rawDir, `${name}.json`), "utf8"));
  } catch {
    return undefined;
  }
}

function save(name, request, answer) {
  const scrubber = createScrubber();
  const payload = scrubber.scrub(answer.body);

  writeFileSync(`${here}${name}.json`, `${JSON.stringify(payload, null, 2)}\n`);
  written.push({
    file: `${name}.json`,
    // Scrubbed too: the comments request names a post by its URL, and a post
    // URL starts with its author's name. The first run committed one here.
    request: createScrubber().scrub(request),
    httpStatus: answer.status,
    capturedAt: new Date().toISOString(),
    identitiesReplaced: scrubber.replaced(),
  });
}

/** One paid request, with the balance read either side of it. */
async function capture(name, path, params) {
  const request = { path, params };

  if (rescrub) {
    const raw = readRaw(name);
    if (!raw) {
      failures.push(`${name}: no raw answer in ${rawDir}`);
      return undefined;
    }
    save(name, raw.request, raw.answer);
    return raw.answer;
  }

  const before = await account();
  const answer = await call(path, params);
  const after = await account();

  saveRaw(name, answer, request);
  save(name, request, answer);

  ledger.push({
    run: name,
    request: createScrubber().scrub(request),
    httpStatus: answer.status,
    elapsedMs: answer.elapsedMs,
    accountFieldsMoved: moved(before, after),
  });

  if (answer.status !== 200) failures.push(`${name}: HTTP ${answer.status}`);
  return answer;
}

const only = process.argv
  .filter((argument) => argument.startsWith("--only="))
  .map((argument) => argument.slice("--only=".length));

const wanted = (name) => only.length === 0 || only.some((part) => name.includes(part));

// ---------------------------------------------------------------- the run

const answers = {};

if (!rescrub && wanted("credentials")) {
  // Question 5. A key that cannot exist, so nothing can be charged to anybody.
  const refused = await call("/linkedin/post-search", { search: keyword }, "not-a-real-key");
  saveRaw("credentials-rejected", refused, { path: "/linkedin/post-search" });
  save("credentials-rejected", { path: "/linkedin/post-search", key: "invalid" }, refused);
  ledger.push({
    run: "credentials-rejected",
    httpStatus: refused.status,
    note: "sent with a deliberately invalid key",
  });

  // The key check a connector makes, refused the same way.
  const probeRefused = await call("/users/my-api-user", {}, "not-a-real-key");
  save("probe-rejected", { path: "/users/my-api-user", key: "invalid" }, probeRefused);
  ledger.push({
    run: "probe-rejected",
    httpStatus: probeRefused.status,
    note: "sent with a deliberately invalid key",
  });

  // Question 6. Two reads of the account, nothing between them.
  const first = await account();
  const second = await account();
  answers.accountRead = {
    httpStatus: first.status,
    fieldsFound: Object.keys(first.money),
    movedBetweenTwoReads: moved(first, second),
  };
}

const searches = [
  ["search-by-date", { search: keyword, sortBy: "date" }],
  ["search-past-24h", { search: keyword, sortBy: "date", postedLimit: "24h" }],
  ["search-page-2", { search: keyword, sortBy: "date", page: "2" }],
  ["search-no-results", { search: impossible, sortBy: "date" }],
];

for (const [name, params] of searches) {
  if (!wanted(name)) continue;
  answers[name] = await capture(name, "/linkedin/post-search", params);
}

if (wanted("comments")) {
  // Question 7. The post with the most comments on the first page, so the
  // shape of a reply has the best chance of appearing.
  const page = answers["search-by-date"]?.body ?? readRaw("search-by-date")?.answer?.body;
  const posts = Array.isArray(page?.elements) ? page.elements : [];
  const target = [...posts].sort(
    (a, b) => (b?.engagement?.comments ?? 0) - (a?.engagement?.comments ?? 0),
  )[0];

  if (target?.linkedinUrl) {
    answers.comments = await capture("comments", "/linkedin/post-comments", {
      post: target.linkedinUrl,
      sortBy: "date",
    });
  } else {
    failures.push("comments: no post URL from search-by-date to ask about");
  }
}

// ------------------------------------------------------------ the answers

const bodyOf = (name) => answers[name]?.body ?? readRaw(name)?.answer?.body;

function describePage(name) {
  const body = bodyOf(name);
  if (!body || typeof body !== "object") return undefined;

  const elements = Array.isArray(body.elements) ? body.elements : [];
  const dates = elements
    .map((post) => post?.postedAt?.date)
    .filter((date) => typeof date === "string");

  const newestFirst = dates.every((date, index) => index === 0 || dates[index - 1] >= date);

  return {
    items: elements.length,
    pagination: body.pagination ?? null,
    status: body.status ?? null,
    error: body.error ?? null,
    newest: dates.length ? [...dates].sort().at(-1) : null,
    oldest: dates.length ? [...dates].sort()[0] : null,
    orderedNewestFirst: newestFirst,
    // Question 4: the id is a bare number and the URL ends in the same one.
    idsAreActivityIds: elements.every(
      (post) =>
        typeof post?.id === "string" &&
        /^\d{15,}$/.test(post.id) &&
        typeof post?.linkedinUrl === "string" &&
        post.linkedinUrl.includes(post.id),
    ),
    distinctIds: new Set(elements.map((post) => post?.id)).size,
    fields: [...new Set(elements.flatMap((post) => Object.keys(post ?? {})))].sort(),
  };
}

function readCommittedFindings() {
  try {
    return JSON.parse(readFileSync(`${here}findings.json`, "utf8"));
  } catch {
    return {};
  }
}

const findings = {
  note: "Computed by capture.mjs from the answers it wrote. US-386 reads these.",
  // A `--rescrub` or `--only=` run asks no account question; keep the last
  // answer rather than dropping it.
  accountRead: answers.accountRead ?? readCommittedFindings().accountRead,
  pages: Object.fromEntries(
    searches.map(([name]) => [name, describePage(name)]).filter(([, value]) => value),
  ),
};

const first = bodyOf("search-by-date")?.elements ?? [];
const second = bodyOf("search-page-2")?.elements ?? [];
if (first.length && second.length) {
  const ids = new Set(first.map((post) => post?.id));
  findings.pageTwoOverlapsPageOne = second.filter((post) => ids.has(post?.id)).length;
}

const comments = bodyOf("comments");
if (comments && typeof comments === "object") {
  const elements = Array.isArray(comments.elements) ? comments.elements : [];
  findings.comments = {
    items: elements.length,
    pagination: comments.pagination ?? null,
    fields: [...new Set(elements.flatMap((comment) => Object.keys(comment ?? {})))].sort(),
    nestedReplies: elements.reduce(
      (sum, comment) => sum + (Array.isArray(comment?.replies) ? comment.replies.length : 0),
      0,
    ),
  };
}

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

writeFileSync(`${here}findings.json`, `${JSON.stringify(findings, null, 2)}\n`);

writeFileSync(
  `${here}manifest.json`,
  `${JSON.stringify(
    {
      note:
        "Which request produced each file. Captured from the live API; see " +
        "docs/testing.md on why these are captured and never written.",
      provider: "harvestapi",
      platform: "linkedin",
      files: mergedBy("files", `${here}manifest.json`, written),
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
        "What each request moved on the account, read from /users/my-api-user " +
        "before and after it. Empty means nothing the account reports moved.",
      runs: mergedBy("runs", `${here}ledger.json`, ledger).map((entry) =>
        entry.request ? { ...entry, request: createScrubber().scrub(entry.request) } : entry,
      ),
    },
    null,
    2,
  )}\n`,
);

console.log(JSON.stringify(findings, null, 2));
console.log(
  `\nwrote ${written.length} fixtures. The unscrubbed answers are in ${rawDir}; delete them when done.`,
);
console.log("Read the fixtures before committing them.");

if (failures.length > 0) {
  console.error("\nSome captures did not finish:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
