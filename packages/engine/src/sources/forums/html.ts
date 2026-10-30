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
