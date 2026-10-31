/**
 * Invision Community's activity stream, read for versions 4 and 5. US-485.
 *
 * The stream lists replies among the few new topics. No word of the board's
 * language is read to tell them apart: the item's status line names one member
 * for a new topic and two for a reply, so one profile link or none is a topic.
 * A guest writes no profile link, which can make a reply look new: the
 * thread page's own start time drops it when the post is completed.
 *
 * A new topic's text is cut on the stream, so the program's `feedText` is
 * "cut" and the thread page completes it. Each item carries the activity time
 * as a Unix second; "Load more" asks the stream address for the time of the
 * page's last item.
 */
import { type FeedItem, forumFolder } from "./feeds.js";
import {
  absoluteUrl,
  decodeEntities,
  divContent,
  fromUnixSeconds,
  piecesAt,
  textOf,
} from "./html.js";
import type { ForumStream } from "./types.js";

const streamResults = /<div\b[^>]*\bdata-role=["']streamResults["'][^>]*>/i;
const activityItem = /<li\b[^>]*\bdata-role=["']activityItem["'][^>]*>/i;

const siteOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** The forum's activity stream, from the home page's first `/discover/` link. */
export function invisionFeedUrl(page: string, homeUrl: string): string {
  const site = siteOf(homeUrl);
  for (const link of page.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(decodeEntities(link[1] ?? ""), homeUrl);
      if (siteOf(url.toString()) !== site || !url.pathname.endsWith("/discover/")) continue;
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      // An address no reader could open.
    }
  }
  return new URL("discover/", forumFolder(homeUrl)).toString();
}

/** True for the stream address, with or without its `?before=`. */
export function invisionIsFeed(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith("/discover/");
  } catch {
    return false;
  }
}

/** The thread id from a stream item's address, `/topic/<id>-<slug>/`. */
export function invisionFeedThreadId(url: string): string | null {
  try {
    return new URL(url).pathname.match(/\/topic\/(\d+)-/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function statusOf(item: string, version: 4 | 5): string | undefined {
  return version === 5
    ? item.match(
        /<div\b[^>]*class=["'][^"']*\bipsStreamItem__summary\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
      )?.[1]
    : item.match(
        /<p\b[^>]*class=["'][^"']*\bipsStreamItem_status\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
      )?.[1];
}

function snippetOf(item: string, version: 4 | 5): string {
  const marker =
    version === 5
      ? /<div\b[^>]*class=["'][^"']*\bipsStreamItem__content\b[^"']*["'][^>]*>/i
      : /<div\b[^>]*class=["'][^"']*\bipsStreamItem_snippet\b[^"']*["'][^>]*>/i;
  const opening = item.match(marker);
  return opening?.index === undefined
    ? ""
    : textOf(divContent(item, opening.index + opening[0].length));
}

/**
 * The stream page's new topics. Null when this is not a stream page at all:
 * a thread or a list has no `streamResults` element.
 */
export function readInvisionStream(
  page: string,
  pageUrl: string,
  version: 4 | 5,
): ForumStream | null {
  const results = page.match(streamResults)?.[0];
  if (!results) return null;
  const declared = results.match(/data-streamurl=["']([^"']*)["']/i)?.[1];
  const streamUrl = declared === undefined ? pageUrl : decodeEntities(declared);
  const pieces = piecesAt(page, activityItem);

  const items: FeedItem[] = [];
  let oldest: number | null = null;
  let last: number | null = null;
  for (const piece of pieces) {
    const timestamp = Number(piece.match[0].match(/data-timestamp=["'](\d+)["']/i)?.[1]);
    if (Number.isFinite(timestamp)) {
      oldest = oldest === null ? timestamp : Math.min(oldest, timestamp);
      last = timestamp;
    }
    const topic = piece.html.match(
      /<a\b[^>]*href=["']([^"']*\/topic\/\d+-[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!topic?.[1]) continue;
    const status = statusOf(piece.html, version);
    if (status === undefined) continue;
    const members = (status.match(/<a\b[^>]*\bdata-ipshover\b/gi) ?? []).length;
    if (members > 1) continue;
    const url = new URL(absoluteUrl(topic[1], pageUrl));
    url.search = "";
    url.hash = "";
    items.push({
      url: url.toString(),
      title: textOf(topic[2] ?? ""),
      publishedAt: fromUnixSeconds(String(timestamp)),
      text: snippetOf(piece.html, version),
    });
  }

  let olderUrl: string | null = null;
  if (last !== null) {
    const base = new URL(streamUrl, pageUrl);
    base.search = "";
    base.hash = "";
    olderUrl = `${base.toString()}?before=${last}`;
  }
  return {
    items,
    olderUrl,
    oldest: oldest === null ? null : new Date(oldest * 1000),
  };
}
