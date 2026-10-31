/**
 * Invision Community 5. US-485.
 *
 * The body keeps Invision 4's `ipsApp ipsApp_front` class and adds
 * `data-ips-hook`, which is what tells the two versions apart. Its thread page
 * keeps `data-role="commentContent"` and an `elComment_<n>` article; its title
 * is `<h1 data-ips-hook="title">`. Its activity stream is read by the shared
 * reader, and a section list has no reader yet: a whole forum is read through
 * its stream.
 */
import { absoluteUrl, divContent, fromIso, textOf } from "./html.js";
import {
  invisionFeedThreadId,
  invisionFeedUrl,
  invisionIsFeed,
  readInvisionStream,
} from "./invision-stream.js";
import type { ForumProgram } from "./types.js";

const timeIn = (html: string) => fromIso(html.match(/<time datetime=['"]([^'"]+)['"]/)?.[1]);

export const invision5: ForumProgram = {
  id: "invision5",
  displayName: "Invision Community 5",

  detect(html) {
    const body = html.match(/<body\b[^>]*>/)?.[0] ?? "";
    return (
      /class=['"]ipsApp ipsApp_front/.test(body) &&
      body.includes("data-ips-hook") &&
      (/data-role=['"]commentContent['"]/.test(html) || /data-role=['"]activityItem['"]/.test(html))
    );
  },

  newestThreadsUrl: (sectionUrl) => sectionUrl,

  // Section lists are not in scope: an Invision 5 forum is read by its stream.
  listThreads: () => [],

  readThread(html, pageUrl) {
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? pageUrl;
    const id = canonical.match(/\/topic\/(\d+)-/)?.[1];
    const heading = html.match(/<h1 data-ips-hook="title"[^>]*>([\s\S]*?)<\/h1>/)?.[1];
    const post = html.search(/<article\b[^>]*\bid=['"]elComment_\d+/);
    if (!id || heading === undefined || post < 0) return null;
    const rest = html.slice(post);
    const content = rest.match(/<div[^>]*data-role=['"]commentContent['"][^>]*>/);
    if (content?.index === undefined) return null;
    return {
      id,
      url: absoluteUrl(canonical, pageUrl),
      title: textOf(heading),
      text: textOf(divContent(rest, content.index + content[0].length)),
      postedAt: timeIn(rest),
      approximatePostedAt: false,
    };
  },

  readStream(html, pageUrl) {
    const body = html.match(/<body\b[^>]*>/)?.[0] ?? "";
    if (!/class=['"]ipsApp ipsApp_front/.test(body) || !body.includes("data-ips-hook")) return null;
    return readInvisionStream(html, pageUrl, 5);
  },

  feedUrl: invisionFeedUrl,
  isFeed: invisionIsFeed,
  feedText: "cut",
  feedThreadId: invisionFeedThreadId,

  detectIndex: (html) => {
    const body = html.match(/<body\b[^>]*>/)?.[0] ?? "";
    return (
      /class=['"]ipsApp ipsApp_front/.test(body) &&
      body.includes("data-ips-hook") &&
      /\/forum\/\d+-/.test(html)
    );
  },
};
