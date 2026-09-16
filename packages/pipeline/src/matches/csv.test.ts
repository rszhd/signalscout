/**
 * The inbox as a spreadsheet.
 *
 * Correctness-critical: a cell built from a stranger's words must never become
 * a formula. Every case below is a post somebody could really write, because
 * this file is made from social media text and the person opening it is the
 * customer.
 *
 * The round-trip tests parse the output rather than reading it, because
 * eyeballing a CSV is how a quoting bug survives.
 */
import { describe, expect, it } from "vitest";
import { csvCell, csvFilename, matchesToCsv, utf8ByteOrderMark } from "./csv.js";
import type { InboxMatch } from "./matches.js";

function match(overrides: Partial<InboxMatch> = {}): InboxMatch {
  return {
    id: "1",
    monitorId: "m1",
    monitorName: "Flaky tests",
    score: 86,
    rank: 80,
    relevance: 90,
    problemFit: 72,
    icpFit: 84,
    intent: 94,
    urgency: 60,
    intentType: "asking_for_recommendations",
    intentLabel: "Asking for recommendations",
    reasons: ["asks what others use"],
    saved: false,
    verdict: null,
    readAt: null,
    source: "reddit",
    channel: "SaaS",
    kind: "post",
    parentTitle: null,
    parentExcerpt: null,
    parentUrl: null,
    author: "somebody",
    title: "How do I reach my first client?",
    excerpt: "I built a SaaS and cannot find customers.",
    url: "https://www.reddit.com/r/SaaS/comments/abc/x/",
    postedAt: new Date("2026-09-07T07:50:44.000Z"),
    ...(overrides as Partial<InboxMatch>),
  } as InboxMatch;
}

/**
 * A CSV reader, so a round trip is parsed rather than eyeballed.
 *
 * Small on purpose: it understands quoting, doubled quotes and newlines inside
 * a field, which is exactly what the writer has to get right.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const body = text.startsWith(utf8ByteOrderMark) ? text.slice(1) : text;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];

    if (quoted) {
      if (char === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && body[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else cell += char;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

describe("a cell can only ever be text", () => {
  /**
   * The four characters Excel and Sheets read as the start of a formula.
   *
   * `=cmd|' /C calc'!A0` is a real attack, not a hypothetical, and a post
   * beginning with a dash is an ordinary sentence.
   */
  for (const start of ["=", "+", "-", "@"]) {
    it(`defuses a cell starting with "${start}"`, () => {
      const written = csvCell(`${start}cmd|' /C calc'!A0`);

      expect(written.startsWith("'")).toBe(true);
      // And a reader still gets the words back, apostrophe aside.
      expect(written).toContain(`${start}cmd`);
    });
  }

  it("defuses a tab or a carriage return in front of a formula", () => {
    // Some readers strip whitespace before looking at the first character, so
    // "\t=cmd" becomes "=cmd" after the check would have passed.
    //
    // Asserted on the parsed cell rather than the written one: a field holding
    // a carriage return is also quoted, so the apostrophe sits inside the
    // quotes where a reader will find it. That is the shape the other test
    // pins, and checking the raw string here would fail for a correct file.
    expect(parseCsv(`${csvCell("\t=1+1")}\r\n`)[0]?.[0]?.startsWith("'")).toBe(true);
    expect(parseCsv(`${csvCell("\r=1+1")}\r\n`)[0]?.[0]?.startsWith("'")).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    expect(csvCell("How do I reach my first client?")).toBe("How do I reach my first client?");
    expect(csvCell(86)).toBe("86");
  });

  it("writes nothing for a missing value rather than the word null", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("puts the prefix inside the quotes, so the format still parses", () => {
    // Outside the quotes it would break the field. A reader strips the
    // apostrophe; a parser must never see it before the opening quote.
    const written = csvCell('=SUM(A1),"hi"');

    expect(written.startsWith('"')).toBe(true);
    expect(parseCsv(`${written}\r\n`)[0]?.[0]).toBe('\'=SUM(A1),"hi"');
  });
});

describe("what a post survives", () => {
  it("keeps quotes, commas and newlines through a round trip", () => {
    const messy = 'He said "use Playwright", then\nasked about price, twice.';
    const csv = matchesToCsv([match({ excerpt: messy })]);
    const rows = parseCsv(csv);

    expect(rows[1]?.[7]).toBe(messy);
  });

  it("keeps the characters Excel gets wrong without a byte order mark", () => {
    // US-044 found two Spanish comments among seven matches, and the database
    // holds Hebrew and emoji too.
    const text = "¿Qué usan? עברית 🎯";
    const rows = parseCsv(matchesToCsv([match({ excerpt: text })]));

    expect(rows[1]?.[7]).toBe(text);
  });

  it("starts with a byte order mark, so Excel reads it as UTF-8", () => {
    expect(matchesToCsv([]).startsWith(utf8ByteOrderMark)).toBe(true);
  });
});

describe("the file a person opens", () => {
  it("names its columns, in the order somebody scans them", () => {
    const [header] = parseCsv(matchesToCsv([]));

    expect(header).toEqual([
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
    ]);
  });

  it("carries what a person needs to act on a match", () => {
    const [, row] = parseCsv(matchesToCsv([match({ verdict: "good", saved: true })]));

    expect(row).toEqual([
      "86",
      "Asking for recommendations",
      "2026-09-07T07:50:44.000Z",
      "reddit",
      "SaaS",
      "somebody",
      "How do I reach my first client?",
      "I built a SaaS and cannot find customers.",
      "https://www.reddit.com/r/SaaS/comments/abc/x/",
      "Flaky tests",
      "good",
      "yes",
    ]);
  });

  it("writes an empty cell where there is nothing, not the word null", () => {
    const [, row] = parseCsv(matchesToCsv([match({ channel: null, author: null, title: null })]));

    expect(row?.[4]).toBe("");
    expect(row?.[5]).toBe("");
    expect(row?.[6]).toBe("");
  });

  it("is a header and nothing else when the inbox is empty", () => {
    expect(parseCsv(matchesToCsv([]))).toHaveLength(1);
  });

  it("names the file after the day it was taken", () => {
    expect(csvFilename(new Date("2026-09-07T22:53:00.000Z"))).toBe(
      "signalscout-inbox-2026-09-07.csv",
    );
  });
});
