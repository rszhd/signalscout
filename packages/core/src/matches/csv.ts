/**
 * The inbox as a spreadsheet.
 *
 * Correctness-critical: a cell built from a stranger's words must never become
 * a formula. This file is made from social media text, and the person opening
 * it is the customer.
 *
 * US-064. CSV rather than `.xlsx`: Excel opens it, Sheets opens it, every CRM
 * imports it, and writing one needs nothing but string handling. An `.xlsx`
 * writer is a library and a binary format bought for nothing this product
 * needs.
 */
import type { InboxMatch } from "./matches.js";

/**
 * The columns, in the order somebody scans them.
 *
 * Score first because that is what the inbox is sorted by, then the words that
 * say what it is, then the link — which is the column a person actually acts
 * on. The rest is provenance: which monitor found it, what was judged, whether
 * it was kept.
 */
const columns = [
  "score",
  "intent",
  "posted_at",
  "platform",
  "channel",
  "author",
  "title",
  "text",
  "url",
  "monitor",
  "verdict",
  "saved",
] as const;

/**
 * Characters Excel and Sheets read as the start of a formula.
 *
 * `=` is the obvious one. `+` and `-` start a formula too, and `-` is how a
 * sentence beginning with a dash arrives. `@` is Excel's old intersection
 * operator and still triggers it. Tab and carriage return are here because
 * both are stripped by some readers *before* the first character is examined,
 * so `\t=cmd` becomes `=cmd`.
 */
const formulaStarts = ["=", "+", "-", "@", "\t", "\r"];

/**
 * One cell, escaped so it can only ever be text.
 *
 * Two separate jobs, and conflating them is how this goes wrong. **Quoting**
 * is CSV's own rule: a field holding a quote, a comma or a newline is wrapped
 * in quotes and its own quotes are doubled. **Prefixing** is a defence against
 * the spreadsheet: a leading formula character gets a single quote in front,
 * which Excel and Sheets both read as "this is text".
 *
 * The prefix goes on before the quoting, so the apostrophe is inside the
 * quoted field where a reader will strip it, rather than outside it where it
 * would break the format.
 *
 * A post that opens `=cmd|' /C calc'!A0` is a real attack and not a
 * hypothetical, and this product collects exactly that kind of text from
 * strangers.
 */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);

  const defused = text.length > 0 && formulaStarts.includes(text[0] as string) ? `'${text}` : text;

  return /["\n\r,]/.test(defused) ? `"${defused.replaceAll('"', '""')}"` : defused;
}

function row(values: readonly unknown[]): string {
  return values.map(csvCell).join(",");
}

/**
 * The byte order mark.
 *
 * Excel reads a CSV in the local code page unless a file says otherwise, and
 * the posts in this database include Spanish, Hebrew characters and emoji —
 * US-044 found two Spanish comments among seven matches. Without this, a
 * person's first impression of the feature is that it is broken.
 */
export const utf8ByteOrderMark = "﻿";

/**
 * Every match as one CSV file.
 *
 * `\r\n` line endings, which is what RFC 4180 says and what Excel is happiest
 * with. The excerpt goes in the `text` column rather than the whole post,
 * because the excerpt is all this product stores — bounded on purpose, so that
 * content an author removes is cheap to stop showing. The link is the column a
 * person opens.
 */
export function matchesToCsv(matches: readonly InboxMatch[]): string {
  const lines = [
    row(columns),
    ...matches.map((match) =>
      row([
        match.score,
        match.intentLabel,
        match.postedAt.toISOString(),
        match.source,
        match.channel,
        match.author,
        match.title,
        match.excerpt,
        match.url,
        match.monitorName,
        match.verdict,
        match.saved ? "yes" : "no",
      ]),
    ),
  ];

  return `${utf8ByteOrderMark}${lines.join("\r\n")}\r\n`;
}

/** `intentwatch-inbox-2026-09-07.csv`: what it is, and when it was taken. */
export function csvFilename(now: Date): string {
  return `intentwatch-inbox-${now.toISOString().slice(0, 10)}.csv`;
}
