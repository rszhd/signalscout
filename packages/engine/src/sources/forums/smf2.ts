/**
 * Simple Machines Forum 2.0. US-469.
 *
 * Detected by its topic cells (`<td class="subject`) beside `topic=<id>.0`
 * links, or by its post blocks (`class="post_wrapper"`). A pinned row's cells
 * carry `stickybg`. SMF 2.0 writes every date in words, in the format the
 * board chose, so they go through `fromEnglishDate`.
 *
 * The list shows no start time, only the last post's: `startedAt` is null,
 * and a reader opens the thread to learn it. Sorted by first post, the
 * newest threads come first after the pinned ones.
 */
import { absoluteUrl, fromEnglishDate, piecesAt, textOf } from "./html.js";
import type { ForumProgram, ForumThreadSummary } from "./types.js";

export const smf2: ForumProgram = {
  id: "smf2",
  displayName: "SMF 2.0",

  detect: (html) =>
    /topic=\d+\.0/.test(html) &&
    (/<td class="subject/.test(html) || /class="post_wrapper"/.test(html)),

  newestThreadsUrl(sectionUrl) {
    // SMF separates its own parameters with semicolons, not ampersands.
    const base = sectionUrl.replace(/;sort=[^;]*(;desc)?/, "");
    return `${base};sort=first_post;desc`;
  },

  listThreads(html, pageUrl, now = new Date()) {
    const threads: ForumThreadSummary[] = [];
    for (const piece of piecesAt(html, /<td class="subject([^"]*)"/)) {
      const link = piece.html.match(
        /<span id="msg_\d+"><a href="([^"]*topic=(\d+)\.0[^"]*)">([\s\S]*?)<\/a>/,
      );
      if (!link?.[1] || !link[2]) continue;
      // The last post's date: the text after its link, before "by".
      const last = piece.html.match(/<td class="lastpost[^"]*">[\s\S]*?<\/a>([\s\S]*?)<br/);
      threads.push({
        id: link[2],
        url: absoluteUrl(link[1], pageUrl),
        title: textOf(link[3] ?? ""),
        startedAt: null,
        approximateStart: false,
        lastActivityAt: last ? fromEnglishDate(last[1] ?? "", now) : null,
        pinned: /\bsticky/.test(piece.match[1] ?? ""),
      });
    }
    return threads;
  },

  readThread(html, pageUrl, now = new Date()) {
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? pageUrl;
    const id = canonical.match(/topic=(\d+)/)?.[1];
    const post = html.indexOf('class="post_wrapper"');
    if (!id || post < 0) return null;
    const rest = html.slice(post);
    const subject = rest.match(/<h5 id="subject_\d+">\s*<a[^>]*>([\s\S]*?)<\/a>/)?.[1];
    const posted = rest.match(/<strong>\s*on:<\/strong>([\s\S]*?)&#187;/)?.[1];
    const body = rest.search(/<div class="inner" id="msg_\d+">/);
    if (body < 0) return null;
    const end = rest
      .slice(body)
      .search(/<div class="moderatorbar">|<div id="msg_\d+_footer"|<div class="attachments"/);
    return {
      id,
      url: absoluteUrl(canonical, pageUrl),
      title: textOf(subject ?? html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""),
      text: textOf(rest.slice(body, end >= 0 ? body + end : undefined)),
      postedAt: posted ? fromEnglishDate(posted, now) : null,
      approximatePostedAt: true,
    };
  },
};
