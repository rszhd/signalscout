/**
 * bbPress, the forum plugin for WordPress. US-469.
 *
 * Detected by `id="bbpress-forums"` or its topic rows (`<ul id="bbp-topic-`).
 * A row's class marks a pinned topic (`sticky`, `super-sticky`). The list
 * shows no start time; its freshness is relative words ("15 hours, 9 minutes
 * ago"), which need no zone, with the same moment in the link's title in
 * words as a fallback. A topic page carries its exact start in
 * `article:published_time`. bbPress lists by freshness and has no sort by
 * start time.
 */
import {
  absoluteUrl,
  fromAgo,
  fromEnglishDate,
  fromIso,
  metaContent,
  piecesAt,
  textOf,
} from "./html.js";
import type { ForumProgram, ForumThreadSummary } from "./types.js";

export const bbpress: ForumProgram = {
  id: "bbpress",
  displayName: "bbPress",

  detect: (html) => /id="bbpress-forums"/.test(html) || /<ul id="bbp-topic-\d+"/.test(html),

  newestThreadsUrl: (sectionUrl) => sectionUrl,

  listThreads(html, pageUrl, now = new Date()) {
    const threads: ForumThreadSummary[] = [];
    for (const piece of piecesAt(html, /<ul id="bbp-topic-(\d+)"[^>]*class="([^"]*)"/)) {
      const [, id, classes = ""] = piece.match;
      const link = piece.html.match(
        /<a class="bbp-topic-permalink" href="([^"]+)">([\s\S]*?)<\/a>/,
      );
      if (!id || !link?.[1]) continue;
      const fresh = piece.html.match(
        /class="bbp-topic-freshness">\s*<a[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/,
      );
      threads.push({
        id,
        url: absoluteUrl(link[1], pageUrl),
        title: textOf(link[2] ?? ""),
        startedAt: null,
        approximateStart: false,
        lastActivityAt: fresh
          ? (fromAgo(fresh[2] ?? "", now) ?? fromEnglishDate(fresh[1] ?? "", now))
          : null,
        pinned: /\bsticky\b|\bsuper-sticky\b/.test(classes),
      });
    }
    return threads;
  },

  readThread(html, pageUrl) {
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? pageUrl;
    const id = html.match(/<ul id="bbp-topic-(\d+)-lead"/)?.[1];
    const heading = html.match(/<h1 class="page-title">([\s\S]*?)<\/h1>/)?.[1];
    const start = html.indexOf('class="bbp-topic-content">');
    if (!id || heading === undefined || start < 0) return null;
    const end = html.indexOf("</div><!-- .bbp-topic-content", start);
    return {
      id,
      url: absoluteUrl(canonical, pageUrl),
      title: textOf(heading),
      text: textOf(
        html.slice(start + 'class="bbp-topic-content">'.length, end >= 0 ? end : undefined),
      ),
      postedAt: fromIso(metaContent(html, "article:published_time")),
      approximatePostedAt: false,
    };
  },
};
