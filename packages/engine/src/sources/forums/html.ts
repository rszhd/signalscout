/**
 * The few HTML operations the forum parsers share. US-469.
 *
 * No DOM: each parser cuts a page at markers its forum program always writes,
 * and these helpers turn the pieces into text, dates and addresses. A marker
 * that moves is a new version of the program, and gets its own parser.
 */

const named: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith("#")) {
      const point =
        code[1]?.toLowerCase() === "x"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : whole;
    }
    return named[code.toLowerCase()] ?? whole;
  });
}

/** What a reader sees: tags gone, line breaks kept, spaces squeezed. */
export function textOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|blockquote|h\d|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v\r ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Session parameters a forum adds to its links for a visitor with no cookie. */
const sessionParameters = ["sid", "PHPSESSID", "s"];

/**
 * An address from a page, made absolute, with the forum's session id and the
 * fragment removed: two visits must name one thread by one address.
 */
export function absoluteUrl(href: string, base: string): string {
  const url = new URL(decodeEntities(href.trim()), base);
  for (const name of sessionParameters) url.searchParams.delete(name);
  url.hash = "";
  return url.toString();
}

/** A Unix time in seconds, as forums write it in `data-time`. */
export function fromUnixSeconds(value: string | undefined): Date | null {
  if (!value || !/^\d{9,11}$/.test(value)) return null;
  return new Date(Number(value) * 1000);
}

/** An ISO 8601 time, as `<time datetime>` and meta tags write it. */
export function fromIso(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The page cut into pieces, each starting at one match of `start` and ending
 * where the next begins. A list of threads is one piece per thread.
 */
export function piecesAt(html: string, start: RegExp): { match: RegExpExecArray; html: string }[] {
  const flags = start.flags.includes("g") ? start.flags : `${start.flags}g`;
  const matches = [...html.matchAll(new RegExp(start.source, flags))] as RegExpExecArray[];
  return matches.map((match, index) => ({
    match,
    html: html.slice(match.index, matches[index + 1]?.index ?? html.length),
  }));
}

/** The content of the first `<meta>` with this property or name. */
export function metaContent(html: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!new RegExp(`(?:property|name)="${key.replace(/[.:]/g, "\\$&")}"`, "i").test(tag)) continue;
    const content = tag.match(/content="([^"]*)"/i)?.[1];
    if (content !== undefined) return decodeEntities(content);
  }
  return undefined;
}

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function monthIndex(word: string): number {
  const lower = word.toLowerCase();
  return lower.length >= 3 ? monthNames.findIndex((name) => name.startsWith(lower)) : -1;
}

/**
 * A date a forum wrote in English words, read as UTC.
 *
 * Forums print dates in a format their admin chose: "Oct 27, 2026 at 6:35 AM"
 * (XenForo 1), "Wed, 25 February 2026, 12:03:37" (one SMF), "October 28,
 * 2026, 11:02:51 PM" (SMF's default), and "Today at 08:18:14" or "Yesterday
 * at …" for recent ones, which are counted from `now`. A visitor with no
 * account sees the board's own zone, and the page does not name it, so the
 * result can be some hours off. Null for anything else, a date in another
 * language too.
 */
export function fromEnglishDate(text: string, now: Date): Date | null {
  const words = decodeEntities(text.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
  const time = words.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i);
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (time) {
    const [, h, m, sec, half] = time;
    hours = Number(h);
    minutes = Number(m);
    seconds = Number(sec ?? 0);
    if (half) hours = (hours % 12) + (/^p/i.test(half) ? 12 : 0);
  }
  const at = (year: number, month: number, day: number) => {
    if (month < 0 || day < 1 || day > 31 || hours > 23 || minutes > 59) return null;
    return new Date(Date.UTC(year, month, day, hours, minutes, seconds));
  };

  const relative = words.match(/^(today|yesterday)\b/i)?.[1];
  if (relative) {
    const day = new Date(now.getTime() - (relative.toLowerCase() === "yesterday" ? 86_400_000 : 0));
    return at(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  }
  // "2026-10-17, 08:57", the numeric order one MyBB board chose.
  const numeric = words.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (numeric) return at(Number(numeric[1]), Number(numeric[2]) - 1, Number(numeric[3]));
  // "10-14-2026, 05:51 AM", vBulletin 3/4's default, month first.
  const american = words.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\b/);
  if (american) return at(Number(american[3]), Number(american[1]) - 1, Number(american[2]));
  // "'26" is 2026, as vBulletin 5 writes it.
  const year = (written: string) =>
    written.length === 4 ? Number(written) : 2000 + Number(written.replace("'", ""));
  // "25 February 2026" or "13 Oct '26", with or without a weekday in front.
  const dayFirst = words.match(/^(?:[a-z]+,?\s+)?(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4}|'\d{2})/i);
  if (dayFirst)
    return at(year(dayFirst[3] ?? ""), monthIndex(dayFirst[2] ?? ""), Number(dayFirst[1]));
  // "Oct 27, 2026" and "October 28, 2026", with or without a weekday.
  const monthFirst = words.match(
    /^(?:[a-z]+,\s+)?([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}|'\d{2})/i,
  );
  if (monthFirst)
    return at(year(monthFirst[3] ?? ""), monthIndex(monthFirst[1] ?? ""), Number(monthFirst[2]));
  return null;
}

const agoUnits: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

/**
 * "15 hours, 9 minutes ago", counted back from `now`. Unlike a date in words
 * it needs no zone, so it is exact to its smallest unit. Months are 30 days
 * and years 365. Null when the words are not that shape.
 */
export function fromAgo(text: string, now: Date): Date | null {
  const words = decodeEntities(text.replace(/<[^>]+>/g, ""))
    .trim()
    .toLowerCase();
  if (!words.endsWith("ago")) return null;
  let total = 0;
  for (const [, count, unit] of words.matchAll(
    /(\d+)\s+(second|minute|hour|day|week|month|year)s?/g,
  )) {
    total += Number(count) * (agoUnits[unit ?? ""] ?? 0);
  }
  return total > 0 ? new Date(now.getTime() - total) : null;
}
