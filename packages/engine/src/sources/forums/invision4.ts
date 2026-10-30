/**
 * Invision Community 4. US-469.
 *
 * Detected by the `ipsApp ipsApp_front` body class together with a topic row
 * or a post's `data-role='commentContent'`; Invision 5 writes neither. A list
 * row is an `ipsDataItem` with `data-rowid="<id>"`, and ends with its
 * last-poster block: the page's last row is followed by sidebar blocks with
 * their own times and badges. Every time is a `<time datetime>` in ISO, in
 * either quote, so nothing here is read from words.
 *
 * Sorting by start date (`?sortby=start_date`) is refused for a visitor on
 * the board this was captured from, so a section is read as it comes: by last
 * activity, which still puts every new thread on the first page.
 */
import { absoluteUrl, fromIso, piecesAt, textOf } from "./html.js";
import type { ForumProgram, ForumThreadSummary } from "./types.js";

const timeIn = (html: string) => fromIso(html.match(/<time datetime=['"]([^'"]+)['"]/)?.[1]);

/** The inside of the element whose opening tag ends at `from`, nested divs and all. */
function divContent(html: string, from: number): string {
  let depth = 1;
  const tags = /<(\/?)div\b[^>]*>/gi;
  tags.lastIndex = from;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[1] ? -1 : 1;
    if (depth === 0) return html.slice(from, tag.index);
  }
  return html.slice(from);
}

export const invision4: ForumProgram = {
  id: "invision4",
  displayName: "Invision Community 4",

  detect: (html) =>
    /<body[^>]+class=['"]ipsApp ipsApp_front/.test(html) &&
    (html.includes('data-controller="forums.front.forum.topicRow"') ||
      /data-role=['"]commentContent['"]/.test(html)),

  newestThreadsUrl: (sectionUrl) => sectionUrl,

  listThreads(html, pageUrl) {
    const threads: ForumThreadSummary[] = [];
    for (const piece of piecesAt(html, /<li class="ipsDataItem[^"]*"\s+data-rowid="(\d+)"/)) {
      const id = piece.match[1];
      const lastPoster = piece.html.indexOf("ipsDataItem_lastPoster");
      const end = lastPoster >= 0 ? piece.html.indexOf("</ul>", lastPoster) : -1;
      const row = end >= 0 ? piece.html.slice(0, end) : piece.html;
      const link = row.match(/cTopicTitle['"]>\s*<a href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/);
      if (!id || !link?.[1]) continue;
      const meta = row.indexOf("ipsDataItem_meta");
      threads.push({
        id,
        url: absoluteUrl(link[1], pageUrl),
        title: textOf(link[2] ?? ""),
        startedAt: meta >= 0 ? timeIn(row.slice(meta)) : null,
        approximateStart: false,
        lastActivityAt: lastPoster >= 0 ? timeIn(row.slice(lastPoster)) : null,
        // The pinned badge is a thumb-tack icon; its title is in the board's language.
        pinned: /fa-thumb-tack|title=['"]Pinned['"]/.test(
          row.slice(0, meta >= 0 ? meta : undefined),
        ),
      });
    }
    return threads;
  },

  readThread(html, pageUrl) {
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? pageUrl;
    const id = canonical.match(/\/topic\/(\d+)-/)?.[1];
    const heading = html.match(/<h1 class=['"]ipsType_pageTitle[^>]*>([\s\S]*?)<\/h1>/)?.[1];
    const post = html.search(/<article\s+id=['"]elComment_\d+/);
    if (!id || heading === undefined || post < 0) return null;
    const rest = html.slice(post);
    const content = rest.match(/<div data-role=['"]commentContent['"][^>]*>/);
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
};
