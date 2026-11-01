/**
 * vBulletin 3 and 4. US-469.
 *
 * Detected by a thread title's `id="thread_title_<id>"` on a list, or a post's
 * `id="post_message_<id>"` on a thread. vBulletin 4 lists threads as
 * `<li class="threadbit" id="thread_<id>">`, the pinned ones first inside
 * `<ol id="stickies">`. Every date is words, month first by default
 * ("10-14-2026, 05:51 AM"), in the board's zone, so starts are approximate.
 * `sort=dateline` lists by start time.
 */

import { feedFrom } from "./feeds.js";
import { absoluteUrl, fromEnglishDate, piecesAt, textOf, withParameters } from "./html.js";
import type { ForumProgram, ForumThreadSummary } from "./types.js";

export const vbulletin4: ForumProgram = {
  id: "vbulletin4",
  displayName: "vBulletin 3/4",

  detect: (html) =>
    (/id="thread_title_\d+"/.test(html) && /showthread\.php\?/.test(html)) ||
    (/id="post_message_\d+"/.test(html) && /showthread\.php\?/.test(html)),

  newestThreadsUrl: (sectionUrl) => withParameters(sectionUrl, { sort: "dateline", order: "desc" }),

  listThreads(html, pageUrl, now = new Date()) {
    // Pinned threads come before the regular list.
    const regular = html.indexOf('<ol id="threads"');
    const threads: ForumThreadSummary[] = [];
    for (const piece of piecesAt(html, /<li class="threadbit[^"]*" id="thread_(\d+)"/)) {
      const id = piece.match[1];
      const link = piece.html.match(
        new RegExp(
          `<a[^>]*href="([^"]*showthread\\.php\\?t=${id}[^"]*)"[^>]*id="thread_title_${id}"[^>]*>([\\s\\S]*?)<\\/a>`,
        ),
      );
      if (!id || !link?.[1]) continue;
      const started = piece.html.match(
        /class="label">Started by[\s\S]*?<\/a>,([\s\S]*?)<\/span>/,
      )?.[1];
      const startedAt = started ? fromEnglishDate(started, now) : null;
      const last = piece.html.match(
        /class="threadlastpost[\s\S]*?<dd>([^<]*?)<span class="time">([^<]*)<\/span>/,
      );
      threads.push({
        id,
        url: absoluteUrl(link[1], pageUrl),
        title: textOf(link[2] ?? ""),
        startedAt,
        approximateStart: startedAt !== null,
        lastActivityAt: last ? fromEnglishDate(`${last[1]} ${last[2]}`, now) : null,
        pinned: regular >= 0 && (piece.match.index ?? 0) < regular,
      });
    }
    return threads;
  },

  readThread(html, pageUrl, now = new Date()) {
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? pageUrl;
    const id = canonical.match(/[?&]t=(\d+)/)?.[1];
    const title = html.match(/class="threadtitle"><a[^>]*>([\s\S]*?)<\/a>/)?.[1];
    const post = html.search(/id="post_message_\d+"/);
    if (!id || title === undefined || post < 0) return null;
    const rest = html.slice(post);
    const open = rest.indexOf(">") + 1;
    const end = rest.indexOf("</blockquote>", open);
    const date = html
      .slice(0, post)
      .match(/<span class="date">([^<]*)<span class="time">([^<]*)<\/span>/g)
      ?.pop();
    const parts = date?.match(/<span class="date">([^<]*)<span class="time">([^<]*)</);
    return {
      id,
      url: absoluteUrl(canonical, pageUrl),
      title: textOf(title),
      text: textOf(rest.slice(open, end >= 0 ? end : undefined)),
      postedAt: parts ? fromEnglishDate(`${parts[1]} ${parts[2]}`, now) : null,
      approximatePostedAt: true,
    };
  },

  // vBulletin 3 has no `forumbit_post` rows, but names its version. BUG-483.
  detectIndex: (html) =>
    (/class="forumbit_(?:no)?post/.test(html) ||
      /vBulletin(?:&reg;|®)?(?: Version)? [34]\.\d/.test(html)) &&
    /forumdisplay\.php\?/.test(html),

  feedUrl: (html, homeUrl) =>
    feedFrom(html, homeUrl, (url) => vbulletin4.isFeed?.(url) ?? false, "external.php?type=RSS2"),
  isFeed: (url) => /\/external\.php\?type=rss2$/i.test(url),
  feedText: "cut",
  feedThreadId: (url) => url.match(/[?&]t=(\d+)/)?.[1] ?? null,
};
