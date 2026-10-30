/**
 * phpBB 3.2 and later, the prosilver family of styles. US-469.
 *
 * Detected by its topic list (`class="topictitle"`) or its posts
 * (`class="post has-profile`), beside a `viewtopic.php` link. Times are
 * `<time datetime>` in ISO 8601; phpBB 3.0 and 3.1 wrote them in words and
 * are not read here.
 *
 * phpBB cannot sort a forum by start time, only by last post (`sk=t`), so
 * the newest-threads list is the most recently active one. Each row still
 * says when its thread started.
 */
import { absoluteUrl, fromIso, piecesAt, textOf } from "./html.js";
import type { ForumProgram, ForumThreadSummary } from "./types.js";

const timeIn = (html: string) => fromIso(html.match(/<time datetime="([^"]+)"/)?.[1]);

export const phpbb3: ForumProgram = {
  id: "phpbb3",
  displayName: "phpBB 3",

  detect: (html) =>
    /viewtopic\.php\?/.test(html) &&
    /<time datetime=/.test(html) &&
    (/class="topictitle"/.test(html) || /class="post has-profile/.test(html)),

  newestThreadsUrl(sectionUrl) {
    const url = new URL(sectionUrl);
    url.searchParams.set("sk", "t");
    url.searchParams.set("sd", "d");
    return url.toString();
  },

  listThreads(html, pageUrl) {
    const threads: ForumThreadSummary[] = [];
    for (const piece of piecesAt(html, /<li class="row ([^"]*)"/)) {
      const link = piece.html.match(
        /<a href="([^"]*viewtopic\.php\?[^"]*?\bt=(\d+)[^"]*)" class="topictitle">([\s\S]*?)<\/a>/,
      );
      if (!link?.[1] || !link[2]) continue;
      const poster = piece.html.indexOf('class="topic-poster');
      const last = piece.html.indexOf('class="lastpost"');
      threads.push({
        id: link[2],
        url: absoluteUrl(link[1], pageUrl),
        title: textOf(link[3] ?? ""),
        startedAt: poster >= 0 ? timeIn(piece.html.slice(poster)) : null,
        lastActivityAt: last >= 0 ? timeIn(piece.html.slice(last)) : null,
        pinned: /\b(sticky|announce|global)\b/.test(piece.match[1] ?? ""),
      });
    }
    return threads;
  },

  readThread(html, pageUrl) {
    const heading = html.match(
      /<h2 class="topic-title"><a href="([^"]*\bt=(\d+)[^"]*)">([\s\S]*?)<\/a>/,
    );
    // The first post; the header row above it shares the class but has no id.
    const post = html.search(/<div id="p\d+" class="post /);
    if (!heading?.[1] || !heading[2] || post < 0) return null;
    const rest = html.slice(post);
    const content = rest.indexOf('<div class="content">');
    if (content < 0) return null;
    const end = rest
      .slice(content)
      .search(/<div id="sig\d+"|<div class="back2top"|<dl class="attachbox"/);
    return {
      id: heading[2],
      url: absoluteUrl(heading[1], pageUrl),
      title: textOf(heading[3] ?? ""),
      text: textOf(rest.slice(content, end >= 0 ? content + end : undefined)),
      postedAt: timeIn(rest),
    };
  },
};
