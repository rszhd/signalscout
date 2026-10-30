/**
 * vBulletin 5. US-469.
 *
 * Detected by its topic rows (`<tr class="topic-item`) or its posts
 * (`class="b-post js-post`). A row carries the thread id
 * (`data-node-id`) and its last activity in Unix seconds
 * (`data-lastcontent`), but writes its start only in words ("Tue 13 Oct '26,
 * 3:46pm"), in the board's zone: on the captured board that read 8 hours
 * early as UTC, so the start is marked approximate. A thread page has the
 * exact start in `<time datetime>`.
 */
import {
  absoluteUrl,
  fromEnglishDate,
  fromIso,
  fromUnixSeconds,
  piecesAt,
  textOf,
} from "./html.js";
import type { ForumProgram, ForumThreadSummary } from "./types.js";

export const vbulletin5: ForumProgram = {
  id: "vbulletin5",
  displayName: "vBulletin 5",

  detect: (html) => /<tr class="topic-item/.test(html) || /class="b-post js-post/.test(html),

  // A channel lists by last activity, and a row still says when it started.
  newestThreadsUrl: (sectionUrl) => sectionUrl,

  listThreads(html, pageUrl, now = new Date()) {
    const threads: ForumThreadSummary[] = [];
    for (const piece of piecesAt(html, /<tr class="topic-item([^"]*)"([^>]*)>/)) {
      const [, classes = "", attributes = ""] = piece.match;
      const id = attributes.match(/data-node-id="(\d+)"/)?.[1];
      const link = piece.html.match(/<a href="([^"]+)" class="topic-title[^"]*">([\s\S]*?)<\/a>/);
      if (!id || !link?.[1]) continue;
      const started = piece.html.match(
        /<div class="topic-info[\s\S]*?<span class="date">([\s\S]*?)<\/span>/,
      )?.[1];
      const startedAt = started ? fromEnglishDate(started, now) : null;
      threads.push({
        id,
        url: absoluteUrl(link[1], pageUrl),
        title: textOf(link[2] ?? ""),
        startedAt,
        approximateStart: startedAt !== null,
        lastActivityAt: fromUnixSeconds(attributes.match(/data-lastcontent="(\d+)"/)?.[1]),
        pinned: /\bsticky\b/.test(classes),
      });
    }
    return threads;
  },

  readThread(html, pageUrl) {
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? pageUrl;
    const id = canonical.match(/\/(\d+)-[^/]*\/?$/)?.[1];
    const heading = html.match(/<h1 class="main-title[^"]*">([\s\S]*?)<\/h1>/)?.[1];
    const post = html.search(/class="b-post js-post[^"]*b-post--first/);
    if (!id || heading === undefined || post < 0) return null;
    const rest = html.slice(post);
    const body = rest.search(/class="js-post__content-text[^"]*"[^>]*>/);
    if (body < 0) return null;
    const open = rest.indexOf(">", body) + 1;
    const end = rest.indexOf('<div class="b-post__footer', open);
    return {
      id,
      url: absoluteUrl(canonical, pageUrl),
      title: textOf(heading),
      text: textOf(rest.slice(open, end >= 0 ? end : undefined)),
      postedAt: fromIso(rest.match(/<time itemprop="dateCreated" datetime='([^']+)'/)?.[1]),
    };
  },
};
