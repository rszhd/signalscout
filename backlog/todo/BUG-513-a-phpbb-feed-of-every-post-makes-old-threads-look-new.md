---
id: BUG-513
title: A phpBB feed of every post makes old threads look new
type: bug
priority: p2
created: 2026-11-03T12:40+08:00
parent: US-473
area: engine
resolution:
---

## Context

`phpbb3` says its feed holds the whole first post (`feedText: "full"`), and
that is true of the new-topics feed (`app.php/feed/topics`,
`feed.php?mode=topics`). It is not true of the feed of every post
(`feed.php` with no mode): there each item is a topic's newest post. The
connector takes that item as the thread's first post, with the reply's text
and the reply's date, so a thread years old reads as a new one, and no page
is opened to check it.

Seen on 2026-11-03 on home-barista.com, whose home page names `feed.php`: of
20 items, most were replies ("So have you tried decaf?" under "Coffee
disrupts my sleep..."), each dated by the reply. The forum ignores
`?mode=topics` (one read gave the same 20 items) and has no
`app.php/feed/topics` (one read gave nothing). An item may also link to a
later page of its thread: `...-t54490-2310.html` is page 2310 of topic
54490, so opening the item's own address would read a reply again.

The owner chose this over dropping the forum: keep reading the feed, and let
the thread's first page decide its text and start, as a cut feed already
does (US-476).

## Acceptance

- [ ] An item of a phpBB feed that is not a new-topics feed (`isFeed` false)
      is a partial post with the poll's `since`, never a whole one.
- [ ] Its address is the thread's first page: `-t123-456.html` becomes
      `-t123.html`; `viewtopic.php?...&start=N` loses `start`; a `#p123`
      or `p=123` post anchor is dropped. Its external id is the topic, so
      two items of one topic are one post.
- [ ] A new-topics feed is unchanged: its items stay whole posts.
- [ ] The complete step reads the first page with `phpbb3.readThread`, and a
      thread started before `since` comes back `old`.
- [ ] Tests on fixtures: the saved feed of every post (home-barista, names
      removed) and one captured home-barista thread page (about $0.0015),
      beside the existing `phpbb3-feed.xml` (a new-topics feed).
- [ ] Engine tests, root `pnpm typecheck` and `pnpm lint` pass.

## Notes

- The connector's feed branches are in
  `packages/engine/src/sources/providers/brightdata/forum.ts` (`fromFeed`,
  `feedPost`); the program in `packages/engine/src/sources/forums/phpbb3.ts`.
- The code is written by DeepSeek from a brief, reviewed and committed here.
- Not yet checked: that `phpbb3.readThread` reads home-barista's thread
  pages (its addresses are rewritten, `-t123.html`). The capture answers it.

## Log
