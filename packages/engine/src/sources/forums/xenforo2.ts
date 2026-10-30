/**
 * XenForo 2. US-469.
 *
 * Detected by `<html id="XF">`; XenForo 1 writes `id="XenForo"`. A list item
 * is a `structItem--thread` whose class names the thread
 * (`js-threadListItem-<id>`); a pinned one holds a sticky status icon rather
 * than a class. Every time is a `<time data-timestamp>` in Unix seconds, so
 * nothing here is read from words. The markup writes `<div  class=` with two
 * spaces on some boards, so every pattern allows any space.
 */
import { absoluteUrl, fromUnixSeconds, piecesAt, textOf } from "./html.js";
import type { ForumProgram, ForumThreadSummary } from "./types.js";

const timestampIn = (html: string) => fromUnixSeconds(html.match(/data-timestamp="(\d+)"/)?.[1]);

export const xenforo2: ForumProgram = {
  id: "xenforo2",
  displayName: "XenForo 2",

  detect: (html) => /<html[^>]+id="XF"/.test(html),

  newestThreadsUrl(sectionUrl) {
    const url = new URL(sectionUrl);
    url.searchParams.set("order", "post_date");
    url.searchParams.set("direction", "desc");
    return url.toString();
  },

  listThreads(html, pageUrl) {
    const threads: ForumThreadSummary[] = [];
    for (const piece of piecesAt(
      html,
      /<div\s+class="structItem structItem--thread[^"]*js-threadListItem-(\d+)/,
    )) {
      const id = piece.match[1];
      const title = piece.html.match(/class="structItem-title"[\s\S]*?<\/div>/)?.[0] ?? "";
      // The title's own link, not a prefix filter: it names this thread.
      const link = title.match(
        new RegExp(`<a\\s+href="([^"]*\\/threads\\/[^"]*?\\.${id}\\/)"[^>]*>([\\s\\S]*?)<\\/a>`),
      );
      if (!id || !link?.[1]) continue;
      const start = piece.html.indexOf('class="structItem-startDate"');
      const last = piece.html.search(/class="structItem-latestDate/);
      threads.push({
        id,
        url: absoluteUrl(link[1], pageUrl),
        title: textOf(link[2] ?? ""),
        startedAt: start >= 0 ? timestampIn(piece.html.slice(start)) : null,
        approximateStart: false,
        lastActivityAt: last >= 0 ? timestampIn(piece.html.slice(last)) : null,
        pinned: piece.html.includes("structItem-status--sticky"),
      });
    }
    return threads;
  },

  readThread(html, pageUrl) {
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? pageUrl;
    const id = canonical.match(/\/threads\/[^/]*?\.(\d+)\//)?.[1];
    const heading = html.match(/<h1 class="p-title-value">([\s\S]*?)<\/h1>/)?.[1];
    const post = html.search(/<article class="message[^"]*message--post/);
    if (!id || heading === undefined || post < 0) return null;
    const rest = html.slice(post);
    const body = rest.indexOf('class="bbWrapper">');
    if (body < 0) return null;
    const end = rest.indexOf('<div class="js-selectToQuoteEnd"', body);
    return {
      id,
      url: absoluteUrl(canonical, pageUrl),
      // A prefix ("Buying") is a label inside the heading, not the title.
      title: textOf(heading.replace(/<span class="label[^"]*"[^>]*>[\s\S]*?<\/span>/g, "")),
      text: textOf(rest.slice(body + 'class="bbWrapper">'.length, end >= 0 ? end : undefined)),
      postedAt: timestampIn(rest),
      approximatePostedAt: false,
    };
  },
};
