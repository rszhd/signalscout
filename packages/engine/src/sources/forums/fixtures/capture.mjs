#!/usr/bin/env node
/**
 * Capture the forum pages the forum parsers read. US-469.
 *
 * docs/testing.md: a fixture for someone else's site is captured, never
 * written. For each forum program and version this saves one "newest threads"
 * list, sorted by start date, and the first thread on it that is not pinned.
 *
 * Every page is fetched through Bright Data's Web Unlocker, the provider the
 * forum connector will use, so a capture sees what the connector will see:
 * most forums put a bot check in front of a plain request. The key and the
 * zone come from the environment, never the command line:
 *
 *     node --env-file=<a .env with BRIGHTDATA_API_KEY and BRIGHTDATA_UNLOCKER_ZONE> \
 *       packages/engine/src/sources/forums/fixtures/capture.mjs [--only=phpbb3] [--pages=index]
 *
 * Bright Data bills each successful request, $1.50 per 1,000 on
 * pay-as-you-go with 5,000 free a month (October 2026); a full run is two or
 * three requests per program. A program whose thread picker is not written
 * yet saves its list only, to write the picker from.
 *
 * What it writes, into this folder:
 *
 *   <program>-list.html     the list page, usernames scrubbed
 *   <program>-thread.html   one thread, usernames scrubbed
 *   <program>-list.json     the same, for a program read through its API
 *   <program>-section.html  a section page's <head>, for detecting the program
 *   <program>-index.html    the forum's home page, names scrubbed (US-473)
 *   <program>-feed.xml      its newest-threads feed, names scrubbed (US-473)
 *   manifest.json           which address produced each file, and when
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * One public forum per program and version, and the first thread on its list
 * that is not pinned. Chosen on 2026-10-30 because a plain request reads them.
 */
const targets = {
  xenforo1: {
    feed: "https://forums.digitalpoint.com/forums/-/index.rss",
    index: "https://forums.digitalpoint.com/",
    list: "https://forums.digitalpoint.com/forums/content-creation.102/?order=post_date&direction=desc",
    thread: (html) => {
      const item = [...html.matchAll(/<li id="thread-(\d+)" class="([^"]*)"/g)].find(
        (match) => !match[2].includes("sticky"),
      );
      const href = item && html.slice(item.index).match(/href="(threads\/[^"]+\.\d+\/)"/)?.[1];
      return href && new URL(href, "https://forums.digitalpoint.com/").toString();
    },
  },
  // Behind a bot check for a plain request: their pickers come from the lists.
  xenforo2: {
    feed: "https://forums.macrumors.com/forums/-/index.rss",
    index: "https://forums.macrumors.com/",
    list: "https://forums.macrumors.com/forums/imac.91/?order=post_date&direction=desc",
    thread: (html) => {
      // A pinned item carries a sticky status icon, not a class of its own.
      const items = [...html.matchAll(/<div\s+class="structItem structItem--thread[^"]*"/g)];
      const item = items.find((match, index) => {
        const piece = html.slice(match.index, items[index + 1]?.index);
        return !piece.includes("structItem-status--sticky");
      });
      const href = item && html.slice(item.index).match(/href="(\/threads\/[^"]+\.\d+\/)"/)?.[1];
      return href && new URL(href, "https://forums.macrumors.com/").toString();
    },
  },
  // WebHostingTalk, one of the forums the model named for a lead-finding tool.
  vbulletin4: {
    feed: "https://www.webhostingtalk.com/external.php?type=RSS2",
    index: "https://www.webhostingtalk.com/",
    list: "https://www.webhostingtalk.com/forumdisplay.php?f=6&sort=dateline&order=desc",
    thread: (html) => {
      // Pinned threads are in <ol id="stickies">; the rest in <ol id="threads">.
      const threads = html.indexOf('<ol id="threads"');
      const id = threads >= 0 && html.slice(threads).match(/id="thread_title_(\d+)"/)?.[1];
      return id && `https://www.webhostingtalk.com/showthread.php?t=${id}`;
    },
  },
  vbulletin5: {
    feed: "https://forum.vbulletin.com/external?type=rss2",
    index: "https://forum.vbulletin.com/",
    list: "https://forum.vbulletin.com/forum/vbulletin-5-connect/vbulletin-5-installations",
    thread: (html) => {
      const row = [...html.matchAll(/<tr class="topic-item([^"]*)"/g)].find(
        (match) => !/sticky/.test(match[1]),
      );
      return row && html.slice(row.index).match(/<a href="([^"]+)" class="topic-title/)?.[1];
    },
  },
  // invisioncommunity.com needs KYC at Bright Data; LinusTechTips runs
  // Invision Community and passed, and its builds section is buyers asking.
  invision4: {
    index: "https://linustechtips.com/",
    list: "https://linustechtips.com/forum/18-new-builds-and-planning/",
    thread: (html) => {
      const rows = html.split(/<li[^>]+class="ipsDataItem[\s"]/).slice(1);
      const row = rows.find(
        (piece) =>
          !/ipsBadge[^"]*"[^>]*>\s*(?:<[^>]+>\s*)*Pinned|ipsDataItem_pinned|fa-thumb-tack/i.test(
            piece.slice(0, 3000),
          ),
      );
      return row?.match(/href="(https:\/\/linustechtips\.com\/topic\/\d+-[^"/]+\/)"/)?.[1];
    },
  },
  // MyBB's own community answered Bright Data with a "Please refresh to
  // continue" challenge on 2026-10-30; Kodi's forum runs MyBB and passed.
  mybb: {
    feed: "https://forum.kodi.tv/syndication.php",
    index: "https://forum.kodi.tv/",
    list: "https://forum.kodi.tv/forumdisplay.php?fid=164&sortby=started&order=desc",
    thread: (html) => {
      // The title's span keeps its id in every theme; the row before it says
      // whether it is pinned (forumdisplay_sticky) or not (forumdisplay_regular).
      const span = [...html.matchAll(/id="tid_(\d+)"/g)].find((match) => {
        const before = html.slice(Math.max(0, match.index - 3000), match.index);
        return [...before.matchAll(/forumdisplay_(sticky|regular)/g)].pop()?.[1] === "regular";
      });
      return span && `https://forum.kodi.tv/showthread.php?tid=${span[1]}`;
    },
  },
  // Read through its JSON API, which needs no key; the section page is HTML.
  discourse: {
    format: "json",
    section: "https://meta.discourse.org/c/support/6",
    list: "https://meta.discourse.org/c/support/6/l/latest.json?order=created",
    thread: (text) => {
      const topic = JSON.parse(text).topic_list.topics.find((t) => !t.pinned && !t.pinned_globally);
      return topic && `https://meta.discourse.org/t/${topic.id}.json`;
    },
  },
  // WordPress's own support forums run bbPress.
  bbpress: {
    feed: "https://wordpress.org/support/topics/feed/",
    index: "https://wordpress.org/support/forums/",
    list: "https://wordpress.org/support/forum/how-to-and-troubleshooting/",
    thread: (html) => {
      const item = [...html.matchAll(/<ul id="bbp-topic-\d+"[^>]*class="([^"]*)"/g)].find(
        (match) => !/sticky/.test(match[1]),
      );
      return (
        item && html.slice(item.index).match(/class="bbp-topic-permalink" href="([^"]+)"/)?.[1]
      );
    },
  },
  // Read through its JSON API, which needs no key; the section page is HTML.
  flarum: {
    format: "json",
    section: "https://discuss.flarum.org/t/support",
    list: "https://discuss.flarum.org/api/discussions?filter%5Btag%5D=support&sort=-createdAt",
    thread: (text) => {
      const discussion = JSON.parse(text).data.find((d) => !d.attributes.isSticky);
      return discussion && `https://discuss.flarum.org/api/discussions/${discussion.id}`;
    },
  },
  smf2: {
    feed: "https://geekhack.org/index.php?action=.xml;type=rss2;sa=news",
    index: "https://geekhack.org/index.php",
    list: "https://geekhack.org/index.php?board=64.0;sort=first_post;desc",
    thread: (html) => {
      const cell = [...html.matchAll(/<td class="subject([^"]*)"/g)].find(
        (match) => !/sticky/.test(match[1]),
      );
      const id = cell && html.slice(cell.index).match(/topic=(\d+)\.0/)?.[1];
      return id && `https://geekhack.org/index.php?topic=${id}.0`;
    },
  },
  phpbb3: {
    feed: "https://forums.gentoo.org/app.php/feed/topics",
    index: "https://forums.gentoo.org/",
    list: "https://forums.gentoo.org/viewforum.php?f=14&sk=t&sd=d",
    thread: (html) => {
      const row = [...html.matchAll(/<li class="row [^"]*"/g)].find(
        (match) => !/sticky|announce|global/.test(match[0]),
      );
      const id = row && html.slice(row.index).match(/viewtopic\.php\?t=(\d+)/)?.[1];
      return id && `https://forums.gentoo.org/viewtopic.php?t=${id}`;
    },
  },
};

// ------------------------------------------------------------- scrubbing

/**
 * Where a forum names a member. Each pattern finds the name in a profile link
 * (skipping tags inside the link, never past its closing </a>: an
 * avatar-only link otherwise took the next thread's title for a name)
 * or an attribute; every name found is then replaced everywhere in the page,
 * so a quote ("name said:"), an avatar's alt text and a title all go too.
 * The same name maps to the same pseudonym inside one page, in any letter case.
 */
const namePatterns = [
  // XenForo: members/<slug>.<id>/, and data-author on posts and quotes.
  /<a[^>]+href="[^"]*members\/[^"]*\.\d+\/?"[^>]*>(?:<(?!\/a\b)[^>]+>)*([^<]{2,60})</g,
  /data-author="([^"]{2,60})"/g,
  // phpBB: memberlist.php?mode=viewprofile&u=<id>.
  /<a[^>]+href="[^"]*memberlist\.php\?mode=viewprofile[^"]*"[^>]*>([^<]{2,60})</g,
  // SMF: action=profile;u=<id>.
  /<a[^>]+href="[^"]*action=profile;u=\d+[^"]*"[^>]*>([^<]{2,60})</g,
  // Invision: showuser=<id> and /profile/<id>-<name>/, in either quote, the
  // name between line breaks; and the name a quote carries. The profile link
  // itself only: /profile/<id>-<name>/solutions/ shows a count.
  /<a[^>]+href=['"][^'"]*(?:showuser=\d+|\/profile\/\d+-[^'"/]*\/?)['"][^>]*>(?:\s*<(?!\/a\b)[^>]+>)*\s*([^<\s][^<]{1,59}?)\s*</g,
  /data-ipsquote-username="([^"]{2,60})"/g,
  // Flarum and Discourse: /u/<name>.
  /<a[^>]+href="[^"]*\/u\/[^"/]+"[^>]*>([^<]{2,60})</g,
  // vBulletin 3/4: member.php?u=<id>, and the name in a "Started by" title.
  /<a[^>]+href="[^"]*member\.php\?u=\d+[^"]*"[^>]*>(?:<(?!\/a\b)[^>]+>)*([^<]{2,60})</g,
  // vBulletin 5: /member/<id>-<name>. MyBB: action=profile&uid=<id>, user-<id>.html.
  /<a[^>]+href="[^"]*\/member\/\d+-[^"]*"[^>]*>(?:<(?!\/a\b)[^>]+>)*([^<]{2,60})</g,
  /<a[^>]+href="[^"]*(?:action=profile(?:&amp;|&)uid=\d+|user-\d+\.html)[^"]*"[^>]*>(?:<(?!\/a\b)[^>]+>)*([^<]{2,60})</g,
  // bbPress: /users/<name>/ links, whose name is also in the address, and the
  // author line. WordPress's profiles live at profiles.wordpress.org/<name>.
  /<a[^>]+href="[^"]*\/users\/[^"/]+\/?"[^>]*>(?:<(?!\/a\b)[^>]+>)*([^<]{2,60})</g,
  /\/users\/([^"/?#\s]{2,60})\//g,
  /profiles\.wordpress\.org\/([^"/?#\s]{2,60})/g,
  /class="bbp-author-name"[^>]*>([^<]{2,60})</g,
  // A thread title that names its author, "My desk PC - by <name>", in a
  // last-post line on an index page.
  / - by ([^<\s]{2,40})\s*<\/a>/g,
  // Feeds: RSS's <dc:creator> and <author>, Atom's <author><name>.
  /<dc:creator>(?:<!\[CDATA\[)?([^<\]]{2,60})/g,
  /<author>(?:[^<(]*\()?([^<)]{2,60})\)?<\/author>/g,
  /<author>\s*<name>(?:<!\[CDATA\[)?([^<\]]{2,60})/g,
];

/** Profile addresses keep their shape and lose their id and name. */
const urlScrubs = [
  [/members\/[^"/]*\.\d+\//g, "members/member.1/"],
  [/(mode=viewprofile(?:&amp;|&)u=)\d+/g, "$11"],
  [/(action=profile;u=)\d+/g, "$11"],
  [/(showuser=)\d+/g, "$11"],
  [/(data-ipsquote-userid=")\d+/g, "$11"],
  [/\/profile\/\d+-[^"/]*/g, "/profile/1-member"],
  [/\/u\/[^"/?#]+/g, "/u/member"],
  [/\/member\/\d+-[^"/?#\s]+/g, "/member/1-member"],
  // vBulletin 3/4: profile, search-by-user and avatar addresses carry the id.
  [/(member\.php\?u=)\d+/g, "$11"],
  [/((?:&amp;|&|\?)userid=)\d+/g, "$11"],
  [/(customavatars\/avatar)\d+_\d+/g, "$11_1"],
  [/(image\.php\?u=)\d+/g, "$11"],
  // A member menu's "Visit Homepage": the member's own site.
  [/<a href="[^"]*"( class="siteicon_homepage")/g, '<a href="https://member.example/"$1'],
  [/(uid=)\d+/g, "$11"],
  [/user-\d+\.html/g, "user-1.html"],
  [/(data-userid=")\d+/gi, "$11"],
  [/(data-vbnamecard=")\d+/g, "$11"],
  // MyBB: uploads/avatars/avatar_<uid>.jpg.
  [/(avatars\/avatar_)\d+/g, "$11"],
  // bbPress names a topic's author in the row's classes.
  [/\buser-id-\d+/g, "user-id-1"],
  [/(avatar\/avatar)\d+_\d+/g, "$11_1"],
  // An email address names a person, staff in a footer too.
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi, "member@example.com"],
  // Avatars: a Gravatar hash is a hash of the member's email; the others carry their id.
  // MD5 (32) or SHA-256 (64).
  [/(gravatar\.com\/avatar\/)[0-9a-f]{32,64}/g, `$1${"0".repeat(32)}`],
  [/(avatar=)\d+_\d+/g, "$11_1"],
  [/(\/avatars\/[a-z]\/)\d+\/\d+/g, "$10/1"],
  [/(class="avatar Av)\d+/g, "$11"],
  [/(data-user-id=")\d+/g, "$11"],
  [/(avatar-u)\d+/g, "$11"],
  // Invision: a member's own photo, in the link to their profile.
  [
    /(class="ipsUserPhoto[^"]*"[^>]*>\s*<img src=)(['"])[^'"]*\2/g,
    "$1$2//member.example/photo.jpg$2",
  ],
  // A member who introduces themselves names themselves: "I'm <name> from",
  // "<name> here from". Only that place: the word may be a common one too.
  [
    /\b(I am |I'm |I&#0?39;m |I’m |[Mm]y name is )[A-Z][a-z]{2,}(?: [A-Z][a-z]{2,})?(?=[,.!]| and | from | here)/g,
    "$1Member",
  ],
  [/\b[A-Z][a-z]{2,}( here from )/g, "Member$1"],
  // Our own session on the forum, not a person's, but it has no business here.
  [/([?&;](?:amp;)?(?:sid|PHPSESSID|s)=)[0-9a-z]{20,40}/gi, "$10"],
];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function scrub(html, pageUrl) {
  // The site's own account ("MacRumors" on forums.macrumors.com) names the
  // site, not a person; replacing it would change every address on the page.
  const ownLabels = pageUrl ? new URL(pageUrl).hostname.toLowerCase().split(".") : [];
  const names = new Set();
  for (const pattern of namePatterns) {
    for (const match of html.matchAll(pattern)) {
      const name = match[1].trim();
      // A count is never a name, and replacing one changes a post's numbers.
      if (name.length >= 2 && !/^[\d\s.,]+$/.test(name) && !ownLabels.includes(name.toLowerCase()))
        names.add(name);
    }
  }
  // A signature is the member's own words about themselves, often a link to
  // their name elsewhere. The parsers never read it.
  // vBulletin 3/4 wraps one in <blockquote class="signature">, around divs;
  // Invision in <div data-role="memberSignature"> around one more div.
  const out = html
    .replace(
      /(<div data-role="memberSignature"[^>]*>)[\s\S]*?(<\/div>\s*<\/div>)/g,
      "$1(signature)$2",
    )
    .replace(
      /(<blockquote[^>]*class="[^"]*\bsignature\b[^"]*"[^>]*>)[\s\S]*?(<\/blockquote>)/g,
      "$1(signature)$2",
    )
    .replace(
      /(<div[^>]*class="[^"]*\bsignature\b[^"]*"[^>]*>)[\s\S]*?(<\/div>)/g,
      "$1(signature)$2",
    );
  return { html: replaceNames(out, names), names: names.size };
}

/** JSON fields that name or picture a member, in Discourse and Flarum. */
const jsonNameKeys = new Set([
  "username",
  "name",
  "display_username",
  "last_poster_username",
  "displayName",
]);
const jsonPictureKeys = new Set(["avatar_template", "avatarUrl"]);

/**
 * The same for a JSON answer: every name field is collected, the member
 * objects lose their ids and pictures, and then each name is replaced
 * wherever it appears, a mention inside a post's HTML too.
 */
export function scrubJson(text) {
  const names = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    const member = "username" in value || "avatar_template" in value;
    // Flarum: a user, or a link to one, is {"type": "users", "id": "123"}.
    if (value.type === "users" && "id" in value) value.id = "1";
    for (const [key, field] of Object.entries(value)) {
      // "name" is a person's only on a member; a category and a group have one
      // too. A Flarum member's "slug" is their username.
      const naming = jsonNameKeys.has(key) ? key !== "name" || member : member && key === "slug";
      if (naming && typeof field === "string" && field.trim().length >= 2) names.add(field.trim());
      else if (jsonPictureKeys.has(key) && typeof field === "string")
        value[key] = "/letter_avatar/member/{size}/1.png";
      else if (key === "user_id" || (member && key === "id")) value[key] = 1;
      else walk(field);
    }
  };
  const parsed = JSON.parse(text);
  walk(parsed);
  return { html: replaceNames(`${JSON.stringify(parsed, null, 2)}\n`, names), names: names.size };
}

function replaceNames(text, names) {
  let out = text;
  let n = 0;
  // Longest first, so "anna" does not cut into "annabel".
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    n += 1;
    // Any case: a member writes their own name differently in a link.
    out = out.replace(new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`, "gi"), `member${n}`);
    // A forum shortens a long link's text, "User:Pieti ... nd": the start of a
    // name, cut, is still the name.
    if (name.length >= 6) {
      out = out.replace(
        new RegExp(
          `(?<![\\w-])${escapeRegExp(name.slice(0, 4))}[\\w-]{0,${name.length - 4}}(?= \\.\\.\\.)`,
          "gi",
        ),
        (cut) => (name.toLowerCase().startsWith(cut.toLowerCase()) ? `member${n}` : cut),
      );
    }
  }
  for (const [pattern, replacement] of urlScrubs) out = out.replace(pattern, replacement);
  return out;
}

// ------------------------------------------------------------- capture

const apiKey = process.env.BRIGHTDATA_API_KEY?.trim();
const zone = process.env.BRIGHTDATA_UNLOCKER_ZONE?.trim();
if (!apiKey || !zone) {
  throw new Error(
    "Set BRIGHTDATA_API_KEY and BRIGHTDATA_UNLOCKER_ZONE in the environment (see the header).",
  );
}
let requests = 0;

async function fetchPage(url) {
  requests += 1;
  const response = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ zone, url, format: "raw" }),
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(
      `${url} answered ${response.status} through Bright Data: ${body.slice(0, 200)}`,
    );
  // Both arrived as 200s on 2026-10-30 and one was saved as a forum page:
  // Bright Data's own refusal (no KYC), and a site's "Please refresh" check.
  if (
    /^(Residential Failed|Proxy Error)/.test(body) ||
    /Please refresh to continue/.test(body.slice(0, 2000))
  )
    throw new Error(`${url} was not passed through Bright Data: ${body.slice(0, 200)}`);
  return body;
}

const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
// One kind of page: `--pages=index` or `--pages=feed` fetches those alone.
const pagesOnly = process.argv.find((arg) => arg.startsWith("--pages="))?.slice(8);
const manifestPath = `${here}manifest.json`;
let manifest = {};
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  // A first run.
}

for (const [program, target] of Object.entries(targets)) {
  if (only && only !== program) continue;
  if (pagesOnly === "index" || pagesOnly === "feed") {
    const url = target[pagesOnly];
    // One forum's refusal leaves the others to fetch.
    try {
      if (url)
        await save(program, [
          [pagesOnly, url, await fetchPage(url), pagesOnly === "feed" ? "xml" : "html"],
        ]);
    } catch (error) {
      console.log(`${program}: ${error.message}`);
    }
    continue;
  }
  const list = await fetchPage(target.list);
  const extension = target.format === "json" ? "json" : "html";
  const pages = [["list", target.list, list, extension]];
  // A picker that finds nothing still leaves the list, to fix the picker from.
  const threadUrl = target.thread?.(list);
  if (target.thread && !threadUrl)
    console.log(`${program}: no thread that is not pinned; the list is saved`);
  if (threadUrl) pages.push(["thread", threadUrl, await fetchPage(threadUrl), extension]);
  // Only the head: it names the program, and a Discourse body carries every
  // poster's name inside avatar addresses and preloaded JSON.
  if (target.section) {
    const page = await fetchPage(target.section);
    pages.push(["section", target.section, page.slice(0, page.search(/<body[\s>]/)), "html"]);
  }
  if (target.index) pages.push(["index", target.index, await fetchPage(target.index), "html"]);
  if (target.feed) pages.push(["feed", target.feed, await fetchPage(target.feed), "xml"]);
  await save(program, pages);
}

async function save(program, pages) {
  for (const [kind, url, body, type] of pages) {
    const scrubbed = type === "json" ? scrubJson(body) : scrub(body, url);
    const file = `${program}-${kind}.${type}`;
    writeFileSync(`${here}${file}`, scrubbed.html);
    manifest[file] = {
      url,
      capturedAt: new Date().toISOString(),
      bytes: scrubbed.html.length,
      namesScrubbed: scrubbed.names,
    };
    console.log(`${file}: ${scrubbed.html.length} bytes, ${scrubbed.names} names scrubbed`);
  }
  // Written as it goes: a later refusal keeps what was paid for.
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(
  `${requests} Bright Data requests, about $${((requests * 1.5) / 1000).toFixed(4)} at the list price`,
);
