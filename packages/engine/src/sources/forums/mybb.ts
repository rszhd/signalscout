/**
 * MyBB 1.8. US-469.
 *
 * Boards restyle MyBB more than any other program read here: its own theme
 * lists threads in a table, Kodi's in `<div>` rows. Two template markers
 * survive both and are what this reads: a thread title's
 * `<span id="tid_<id>">`, and the row class before it, `forumdisplay_sticky`
 * or `forumdisplay_regular`. Every date is words in the board's format and
 * zone ("2026-10-17, 08:57" on Kodi's), so starts are approximate; the
 * default theme shows no start at all. A thread page has no canonical link,
 * so its id comes from the address or the reply link.
 */
import { absoluteUrl, fromEnglishDate, piecesAt, textOf } from "./html.js";
import type { ForumProgram, ForumThreadSummary } from "./types.js";

/** The last text before `end` in `html` that reads as a date. */
function lastDateBefore(html: string, end: number, now: Date): Date | null {
  const texts = [...html.slice(Math.max(0, end - 600), end).matchAll(/>([^<>]{6,40})</g)];
  for (const text of texts.reverse()) {
    const date = fromEnglishDate(text[1] ?? "", now);
    if (date) return date;
  }
  return null;
}

export const mybb: ForumProgram = {
  id: "mybb",
  displayName: "MyBB",

  detect: (html) =>
    (/id="tid_\d+"/.test(html) && /forumdisplay_(sticky|regular)/.test(html)) ||
    (/class="post_body[^"]*" id="pid_\d+"/.test(html) && /showthread\.php\?tid=/.test(html)),

  newestThreadsUrl(sectionUrl) {
    const url = new URL(sectionUrl);
    url.searchParams.set("sortby", "started");
    url.searchParams.set("order", "desc");
    return url.toString();
  },

  listThreads(html, pageUrl, now = new Date()) {
    const threads: ForumThreadSummary[] = [];
    for (const piece of piecesAt(html, /id="tid_(\d+)"/)) {
      const id = piece.match[1];
      const link = piece.html.match(/<a href="([^"]*showthread\.php\?tid=\d+)">([\s\S]*?)<\/a>/);
      if (!id || !link?.[1]) continue;
      const before = html.slice(Math.max(0, piece.match.index - 3000), piece.match.index);
      const row = [...before.matchAll(/forumdisplay_(sticky|regular)/g)].pop()?.[1];
      const started = piece.html.match(/class="thread_start_datetime">([^<]+)</)?.[1];
      const startedAt = started ? fromEnglishDate(started, now) : null;
      const last = piece.html.search(/showthread\.php\?tid=\d+&amp;action=lastpost/);
      threads.push({
        id,
        url: absoluteUrl(link[1], pageUrl),
        title: textOf(link[2] ?? ""),
        startedAt,
        approximateStart: startedAt !== null,
        lastActivityAt: last >= 0 ? lastDateBefore(piece.html, last, now) : null,
        pinned: row === "sticky",
      });
    }
    return threads;
  },

  readThread(html, pageUrl, now = new Date()) {
    const id =
      new URL(pageUrl).searchParams.get("tid") ?? html.match(/newreply\.php\?tid=(\d+)/)?.[1];
    const body = html.search(/class="post_body[^"]*" id="pid_\d+">/);
    if (!id || body < 0) return null;
    const open = html.indexOf(">", body) + 1;
    const end = html.indexOf('<div class="post_meta"', open);
    const posted = html
      .slice(0, body)
      .match(/class="post_date">\s*([^<]+?)\s*</g)
      ?.pop();
    return {
      id,
      url: absoluteUrl(`showthread.php?tid=${id}`, pageUrl),
      title: textOf(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""),
      text: textOf(html.slice(open, end >= 0 ? end : undefined)),
      postedAt: posted
        ? fromEnglishDate(posted.replace(/^[^>]*>/, "").replace(/<$/, ""), now)
        : null,
      approximatePostedAt: true,
    };
  },
};
