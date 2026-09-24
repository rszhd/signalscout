/**
 * The scrubber every LinkedIn capture shares. US-386, BUG-393.
 *
 * The rules are LinkedIn's, not a provider's: the platform puts a person in
 * the same places whoever scraped the page, so one file holds them and every
 * LinkedIn capture imports it. Two copies drifted once, and the older one
 * published two real names.
 *
 * `createScrubber` scrubs a raw answer. `repairScrubbed` repairs an answer an
 * older scrubber already wrote, keeping its pseudonyms, for when the raw
 * answer can no longer be read again.
 *
 * Neither can be complete on a shape nobody has seen. Read what they write.
 */
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

export function createScrubber() {
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

/** Two to four capitalised words: the shape of a person's name in a mention. */
const personName = /^\p{Lu}[\p{L}'’-]+(?: \p{Lu}[\p{L}'’-]+){1,3}$/u;

/**
 * Repair an answer an older scrubber already wrote, in place of scrubbing it
 * again from the raw answer, which a provider may no longer hold.
 *
 * Existing pseudonyms keep their numbers, so a test that reads them does not
 * move. Three things the older scrubber let through are repaired:
 *
 * 1. **A mentioned name left in the text.** Each `PROFILE_MENTION` span is
 *    read in code points, as LinkedIn counts it; a span shaped like a name
 *    and holding no pseudonym is a name. Run it once per folder: after a
 *    replacement the later offsets no longer line up. Every occurrence of it in any post or comment
 *    text is replaced, the joined hashtag form too, with a new pseudonym
 *    numbered after the answer's highest.
 * 2. **An email address**, in any string.
 * 3. **A bare member number** under a person's `urn`.
 *
 * Returns the repaired answer and how many names and numbers it replaced.
 */
export function repairScrubbed(answer) {
  let highest = 0;
  const names = new Set();

  function survey(value) {
    if (typeof value === "string") {
      const found = value.match(/li-user-(\d+)/g) ?? [];
      for (const hit of found) highest = Math.max(highest, Number(hit.slice(8)));
      return;
    }
    if (Array.isArray(value)) return value.forEach(survey);
    if (value === null || typeof value !== "object") return;

    for (const [text, attributes] of [
      ["content", "contentAttributes"],
      ["commentary", "commentaryAttributes"],
    ]) {
      if (typeof value[text] !== "string" || !Array.isArray(value[attributes])) continue;
      const points = Array.from(value[text]);
      for (const attribute of value[attributes]) {
        if (attribute?.type !== "PROFILE_MENTION") continue;
        const span = points.slice(attribute.start, attribute.start + attribute.length).join("");
        // Only a span shaped like a name. After a replacement of a different
        // length the later offsets point at the wrong words, and a fragment
        // such as "li-user-61 Fo" must not be taken for one.
        const candidate = span.trim();
        if (personName.test(candidate) && !candidate.includes("li-user")) names.add(candidate);
      }
    }
    Object.values(value).forEach(survey);
  }

  survey(answer);

  const assigned = new Map();
  const pseudonym = (value) => {
    if (!assigned.has(value)) {
      highest += 1;
      assigned.set(value, `li-user-${highest}`);
    }
    return assigned.get(value);
  };

  function repairNames(text) {
    let out = text;
    for (const name of [...names].sort((a, b) => b.length - a.length)) {
      for (const form of new Set([name, name.replace(/\s+/g, "")])) {
        if (out.includes(form)) out = out.split(form).join(pseudonym(name));
      }
    }
    return out;
  }

  /** In every string, not only post text: a provider may put a post's words under any key. */
  function repairEmails(text) {
    return text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (address) =>
      address.endsWith("@scrubbed.invalid") ? address : `${pseudonym(address)}@scrubbed.invalid`,
    );
  }

  function repair(value, key = "") {
    if (typeof value === "string") {
      return repairEmails(key === "content" || key === "commentary" ? repairNames(value) : value);
    }
    if (Array.isArray(value)) return value.map((child) => repair(child, key));
    if (value === null || typeof value !== "object") return value;

    const isPerson = value.type === "profile" || ["author", "actor", "profile"].includes(key);
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => {
        if (isPerson && childKey === "urn" && typeof child === "string" && /^\d+$/.test(child)) {
          return [childKey, pseudonym(child)];
        }
        return [childKey, repair(child, childKey)];
      }),
    );
  }

  const repaired = repair(answer);
  return { repaired, replaced: assigned.size };
}
