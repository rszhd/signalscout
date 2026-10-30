/**
 * XenForo 1. US-469.
 *
 * Detected by `<html id="XenForo">`; XenForo 2 writes `id="XF"`. A list item
 * is `<li id="thread-<id>">`, with `sticky` in its class when pinned. A
 * recent time is an `<abbr class="DateTime" data-time>` in Unix seconds; an
 * older one is a `<span class="DateTime">` in words, in its title or its
 * text, read by `fromEnglishDate`.
 */
import {
  absoluteUrl,
  fromEnglishDate,
  fromUnixSeconds,
  metaContent,
  piecesAt,
  textOf,
} from "./html.js";
import type { ForumProgram, ForumThreadSummary } from "./types.js";

/** The first XenForo 1 time inside this piece of a page. */
function firstTime(html: string, now: Date): Date | null {
  const found = html.match(/<(?:abbr|span) class="DateTime"([^>]*)>([^<]*)</);
  if (!found) return null;
  const [, attributes = "", text = ""] = found;
  return (
    fromUnixSeconds(attributes.match(/data-time="(\d+)"/)?.[1]) ??
    fromEnglishDate(attributes.match(/title="([^"]+)"/)?.[1] ?? "", now) ??
    fromEnglishDate(text, now)
  );
}

export const xenforo1: ForumProgram = {
  id: "xenforo1",
  displayName: "XenForo 1",

  detect: (html) => /<html[^>]+id="XenForo"/.test(html),

  newestThreadsUrl(sectionUrl) {
    const url = new URL(sectionUrl);
    url.searchParams.set("order", "post_date");
    url.searchParams.set("direction", "desc");
    return url.toString();
  },

  listThreads(html, pageUrl, now = new Date()) {
    const base = html.match(/<base href="([^"]+)"/)?.[1] ?? pageUrl;
    const threads: ForumThreadSummary[] = [];
    for (const piece of piecesAt(html, /<li id="thread-(\d+)" class="([^"]*)"/)) {
      const [, id, classes] = piece.match;
      // The title link carries the preview; the others are prefixes and pages.
      const link = piece.html.match(
        new RegExp(
          `<a\\s[^>]*href="([^"]*threads\\/[^"]*?\\.${id}\\/)"[^>]*PreviewTooltip[^>]*>([\\s\\S]*?)<\\/a>`,
        ),
      );
      if (!id || !link?.[1]) continue;
      const start = piece.html.indexOf('class="startDate"');
      const last = piece.html.indexOf('class="lastPostInfo"');
      threads.push({
        id,
        url: absoluteUrl(link[1], base),
        title: textOf(link[2] ?? ""),
        startedAt: start >= 0 ? firstTime(piece.html.slice(start), now) : null,
        lastActivityAt: last >= 0 ? firstTime(piece.html.slice(last), now) : null,
        pinned: /\bsticky\b/.test(classes ?? ""),
      });
    }
    return threads;
  },

  readThread(html, pageUrl, now = new Date()) {
    const base = html.match(/<base href="([^"]+)"/)?.[1] ?? pageUrl;
    const canonical =
      html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ??
      metaContent(html, "og:url") ??
      pageUrl;
    const id = canonical.match(/threads\/[^/]*?\.(\d+)\//)?.[1];
    const heading = html.match(/<h1>([\s\S]*?)<\/h1>/)?.[1];
    const start = html.indexOf('class="messageText');
    if (!id || heading === undefined || start < 0) return null;
    const body = html.slice(html.indexOf(">", start) + 1, html.indexOf("</article>", start));
    const description = html.indexOf('id="pageDescription"');
    return {
      id,
      url: absoluteUrl(canonical, base),
      // The prefix ("Buying") is a label, not the title.
      title: textOf(heading.replace(/<span class="prefix[^"]*">[\s\S]*?<\/span>/, "")),
      text: textOf(body),
      postedAt: description >= 0 ? firstTime(html.slice(description), now) : null,
    };
  },
};
