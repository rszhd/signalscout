/**
 * A forum's newest-threads feed, RSS 2.0 or Atom, whatever program wrote it.
 * US-473.
 *
 * One reader serves every program: what differs is where the feed lives and
 * whether an item holds a thread's whole first post, which each program says
 * (`ForumProgram.feedUrl`, `feedText`). A field may mix CDATA with escaped
 * text (SMF writes `<![CDATA[[IC]]>&#093;<![CDATA[ ...]]>`), so each part is
 * unescaped on its own before the HTML inside becomes text.
 */
import { absoluteUrl, decodeEntities, textOf } from "./html.js";

/** One item of a feed: a thread, or on some feeds a reply. */
export interface FeedItem {
  /** Absolute, without the forum's session id or a jump to a post. */
  readonly url: string;
  readonly title: string;
  /** Null when the item gives no date a reader can parse. */
  readonly publishedAt: Date | null;
  /** The item's post, tags removed; empty when the feed gives none. */
  readonly text: string;
}

/** The HTML a feed field holds: CDATA kept as it is, the rest unescaped. */
function fieldHtml(raw: string): string {
  return raw
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part) => (part.startsWith("<![CDATA[") ? part.slice(9, -3) : decodeEntities(part)))
    .join("");
}

function field(item: string, ...names: string[]): string | undefined {
  for (const name of names) {
    const raw = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))?.[1];
    if (raw !== undefined) return fieldHtml(raw);
  }
  return undefined;
}

function date(text: string | undefined): Date | null {
  if (!text) return null;
  const time = Date.parse(text.trim());
  return Number.isFinite(time) ? new Date(time) : null;
}

/** A thread's address as a reader opens it, not at the newest post. */
function threadAddress(href: string, pageUrl: string): string {
  const url = new URL(absoluteUrl(href, pageUrl));
  // vBulletin 3/4 links an item to its newest post.
  if (url.searchParams.has("goto")) url.searchParams.delete("goto");
  return url.toString();
}

/**
 * The feed itself, when a browser showed it. Bright Data's unlocker answered
 * one feed three ways on one day: as it is; as Chrome's XML viewer, which
 * keeps the source whole in one element; and as Chrome's text view, the
 * source escaped once inside a `<pre>`.
 */
function unwrapped(body: string): string {
  const viewer = body.indexOf('<div id="webkit-xml-viewer-source-xml">');
  if (viewer >= 0) return body.slice(viewer + 39);
  const text = body.match(
    /^\s*<html><head><meta name="color-scheme"[^>]*><\/head><body><pre[^>]*>([\s\S]*)<\/pre>/,
  );
  return text?.[1] !== undefined ? decodeEntities(text[1]) : body;
}

/** The items of an RSS or Atom feed, in its order; null when the body is neither. */
export function readFeed(page: string, pageUrl: string): FeedItem[] | null {
  const body = unwrapped(page);
  const head = body.slice(0, 1000);
  const rss = /<rss[\s>]/.test(head);
  const atom = /<feed[\s>][\s\S]*?xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/.test(head);
  if (!rss && !atom) return null;
  const items: FeedItem[] = [];
  for (const match of body.matchAll(
    rss ? /<item[\s>][\s\S]*?<\/item>/g : /<entry[\s>][\s\S]*?<\/entry>/g,
  )) {
    const item = match[0];
    const href = rss
      ? (field(item, "link") ?? field(item, "guid"))?.trim()
      : (item.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1] ??
        item.match(/<link[^>]*href="([^"]+)"/)?.[1]);
    if (!href) continue;
    let url: string;
    try {
      url = threadAddress(decodeEntities(href), pageUrl);
    } catch {
      continue;
    }
    items.push({
      url,
      title: textOf(field(item, "title") ?? ""),
      publishedAt: date(field(item, "pubDate", "published", "updated", "dc:date")),
      text: textOf(field(item, "content:encoded", "content", "description", "summary") ?? ""),
    });
  }
  return items;
}

/** A reply, on a feed that lists replies with threads: "Re: …", "Reply To: …". */
export function isReply(item: FeedItem): boolean {
  return /^(re|reply to)\s*:/i.test(item.title);
}

/** The feeds a page names in its head, as absolute addresses, in page order. */
export function advertisedFeeds(html: string, pageUrl: string): string[] {
  const feeds: string[] = [];
  for (const link of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = link[0];
    if (
      !/rel=["']alternate["']/i.test(tag) ||
      !/type=["']application\/(rss|atom)\+xml["']/i.test(tag)
    )
      continue;
    const href = tag.match(/href=(["'])(.*?)\1/i)?.[2];
    if (!href) continue;
    try {
      feeds.push(absoluteUrl(href, pageUrl));
    } catch {
      // An address no reader could open.
    }
  }
  return feeds;
}

/**
 * The forum's folder: the home address as given when it ends in a slash,
 * else its path without the last part, so `forum/index.php` gives `forum/`.
 */
export function forumFolder(homeUrl: string): string {
  const url = new URL(homeUrl);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/[^/]*$/, "");
  return url.toString();
}

/**
 * The feed a program reads: the first the page names that `isFeed` accepts,
 * else `usual`, an address in the forum's folder.
 */
export function feedFrom(
  html: string,
  homeUrl: string,
  isFeed: (url: string) => boolean,
  usual: string,
): string {
  return (
    advertisedFeeds(html, homeUrl).find(isFeed) ?? new URL(usual, forumFolder(homeUrl)).toString()
  );
}

/** XenForo's whole-forum feed, which versions 1 and 2 both write. */
export const isXenForoFeed = (url: string): boolean => {
  const { pathname, search } = new URL(url);
  // `index.php?forums/-/index.rss` on a board without short addresses.
  return /\/forums\/-\/index\.rss$/.test(pathname) || /^\?\/?forums\/-\/index\.rss$/.test(search);
};
