---
id: US-064
title: The inbox leaves as a spreadsheet
type: feature
priority: p2
created: 2026-09-07T22:53+08:00
parent:
area:
resolution: shipped
---

## Context

**The inbox is a screen and the work happens somewhere else.** A person reads
twenty matches, picks six worth acting on, and then wants them in the place
they already run their outreach — a sheet, a CRM import, a shared file a
colleague can read without an account on this instance. Today the only way out
is copying rows by hand.

**CSV rather than `.xlsx`, and the reason is a dependency.** Excel opens CSV,
Sheets opens CSV, every CRM imports CSV, and writing one needs nothing but
string handling. An `.xlsx` writer is a library, a binary format and a
maintenance surface, bought for a file format that offers this product nothing
CSV does not. AGENTS.md: do not add a dependency to avoid a hard problem — and
this is not even a hard problem. Say "CSV, opens in Excel" on the button so
nobody goes looking for the other one.

**Two things about CSV are correctness problems rather than formatting.**

*A cell that starts with `=`, `+`, `-` or `@` is a formula in Excel and in
Sheets.* This file is built from social media text written by strangers, so
that is not a hypothetical: a post beginning `=cmd|...` is a known attack, and
the person opening the file is the customer. Every field is escaped so a cell
can only ever be text.

*Excel reads a CSV as the local code page unless it is told otherwise.* The
posts in this database include Spanish, Hebrew characters and emoji — US-044
found two Spanish comments among seven matches. A file without a UTF-8 byte
order mark opens as mojibake, and a person's first impression of the feature is
that it is broken.

**The export must be the list on screen, not everything.** The inbox has
filters — a project, a monitor, a minimum score, whether dismissed rows show,
and the saved tab — and a button that ignored them would hand somebody a
different list from the one they were looking at. It takes the same query the
screen is using.

**It is a download and not a page.** `Content-Disposition` is what makes a
browser keep it, which `/api/feedback/export` already does for verdicts.

## Acceptance

- [x] A button on the inbox downloads the matches it is currently showing, as
      CSV, and the filename says what and when
- [x] The export honours every filter the screen has applied: project, monitor,
      minimum score, dismissed, saved
- [x] It is not capped at one page: a person exporting an inbox of 300 gets
      300 rows, however the screen paginates
- [x] Every cell is escaped so a leading `=`, `+`, `-` or `@` cannot be read as
      a formula by Excel or Sheets, and a test covers each of the four
- [x] Quotes, commas and newlines inside a post survive a round trip, and a
      test parses the output rather than eyeballing it
- [x] The file carries a UTF-8 byte order mark, so Excel opens the Spanish and
      the emoji correctly
- [x] The columns include what a person needs to act: score, intent, when it
      was posted, platform, channel, author, title, the text, the link, the
      monitor, the verdict and whether it is saved
- [x] `pnpm test`, `pnpm lint` and `pnpm typecheck` pass

## Notes

- `/api/feedback/export` is the pattern for the header and the filename.
- `listMatches` already takes every filter the screen uses. The export should
  reuse it rather than growing a second query that drifts from the first.
- **The excerpt is what we store, not the whole post.** `posts.excerpt` is
  bounded on purpose — Reddit's terms require removed content to stop being
  shown, and the less is held the less there is to remove. The CSV carries the
  excerpt and the link, and the link is what a person opens.
- Do not add `.xlsx` because somebody asks for "Excel". Ask which they need; a
  spreadsheet that opens is what they mean.

## Log

- 2026-09-07T22:53+08:00 — Written at the owner's request: export the inbox to
  CSV or Excel.

- 2026-09-07T23:20+08:00 — Built and closed. **1,368 tests pass**, lint and
  typecheck clean, and the file was pulled from the running instance rather
  than only from a test.

  **171 lines of real inbox came out and parsed cleanly**: 20 matches, 12
  columns each, and **ten of the twenty hold a newline inside a cell** — a
  Reddit post is several paragraphs — every one of which survived a round trip
  through a real CSV reader. The byte order mark is on the wire (`ef bb bf`),
  the content type is `text/csv; charset=utf-8`, and the filename carries the
  day.

  **The formula defence was proven against the database, not only in a unit
  test.** A post title was set to `=cmd|' /C calc'!A0`, the export re-run, and
  the cell came back as `'=cmd|' /C calc'!A0` — defused, with the words still
  readable. The row was put back afterwards. That is the one bug in this
  feature that would have been the customer's problem rather than ours.

  **The filter query moved into `filterQuery()` on the inbox** rather than
  being copied. The export is the second caller of the same filters, and two
  copies would drift the first time a filter is added — which is exactly the
  failure this ticket's Context warned about, arriving in our own code.

  A plain `<a download>` rather than a fetch: the browser downloads it, so
  nothing in the screen holds a file in memory or invents a filename. The
  server sets both.

  `.xlsx` was not added and should not be. CSV opens in Excel, and the label
  says CSV so nobody goes looking for a second button.
