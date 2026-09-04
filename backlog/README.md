# Backlog

One ticket is one Markdown file. The folder a file lives in **is** its status.

```
backlog/
  todo/            work that is agreed and waiting
  doing/           work in progress right now
  parked/          decided to wait, no owner, no date
  done/YYYY-MM/    finished, shipped or dropped
```

## The lists

Two generated files hold every ticket as a table:

- **[OPEN.md](OPEN.md)** — `todo/`, `doing/` and `parked/`, sorted by priority.
- **[DONE.md](DONE.md)** — finished work, newest month first.

Rebuild them from the ticket files:

    backlog/index.sh              # rewrite OPEN.md and DONE.md
    backlog/index.sh --stdout     # print both, write nothing
    backlog/index.sh --check      # exit 1 if either is out of date

The script owns both files whole. Do not edit them by hand; the next run
overwrites the change.

## Rules

1. The folder is the status. There is no `status:` field. Never add one.
2. Changing status means `git mv` of the file, in the same commit as the code
   change that caused it. A ticket that moves without a code change is a
   planning decision, and it may move alone.
3. `id` never changes. The file may be renamed or moved; the id stays.
4. Type is a field, not a folder. Bugs, features and chores share the folders.
5. Keep `doing/` short. One or two tickets per person. A long `doing/` means
   work was started and abandoned, not that work is fast.
6. A ticket that lands in `done/` gets a `resolution:`. Without it, nobody can
   tell later whether the work shipped or was dropped.
7. Run `backlog/index.sh` whenever a ticket is added, moved or closed, in the
   same commit. A stale list is worse than no list.
8. A ticket should be small enough to finish in one session. If it does not
   fit, split it and link the parts with `parent:`.

## File name

    <id>-<short-slug>.md      e.g. US-004-a-monitor-is-created-from-four-answers.md

Ids carry a `US-` or `BUG-` prefix. The prefix survives being pasted into a
commit subject, a code comment or a chat message, where a bare number says
nothing. `index.sh` sorts on the digits and offsets `BUG-` so US-019 and
BUG-019 cannot tie.

The next id, per series:

    ls backlog/*/*.md backlog/done/*/*.md 2>/dev/null \
      | grep -oE '(US|BUG)-[0-9]+' | sort -t- -k2 -n | tail -1

## Frontmatter

```yaml
---
id: US-004
title: Short sentence, present tense
type: feature        # bug | feature | chore | spike
priority: p1         # p0 urgent | p1 next | p2 later | p3 nice
created: 2026-09-04
parent:              # id of the larger ticket, if this is a split part
area:                # optional label; no generated view reads it yet
resolution:          # shipped | dropped | duplicate — only in done/
---
```

`index.sh` reads only this block. It must be correct on every ticket.

## Body

Four headings, in this order. Write no other headings.

- **Context** — why this exists. The part the code cannot say.
- **Acceptance** — a list of checks. Each one is true or false, not a matter
  of opinion.
- **Notes** — files, commands, links found while working.
- **Log** — dated lines added as the work moves. Append only.

A lesson that outlives the ticket goes to the document that owns the subject
([`PLAN.md`](../PLAN.md), [`STACK.md`](../STACK.md), a `docs/` page), never
into a generated list.

## Ordering precedent

Each ticket's own file records why *it* moved. This section holds the
principles, so the next ordering call is not argued from nothing.

- **Detection quality outranks a new source.** PLAN.md sets this as a rule: no
  third social network until Reddit and X reliably produce useful matches. A
  ticket that adds a connector loses to a ticket that improves scoring.
- **A ticket that settles shared vocabulary goes first.** The classification
  schema and the `SocialSource` interface are both named in PLAN.md, and every
  later ticket either uses them or invents a rival.

## Standing decisions

The reasons live in [PLAN.md](../PLAN.md) and [STACK.md](../STACK.md). This is
the short list, so a decision is not reopened by accident.

- **Bring your own keys, for both AI and social APIs.** The user holds the
  account and pays the provider. This is not a fallback mode; it is the
  product.
- **Self-hostable first.** The open-source build is the whole application.
  Nothing is removed to make the hosted version worth paying for.
- **One language, one database, two processes.** TypeScript, Postgres, an API
  and a worker. A ticket that adds a service must say why Postgres cannot do
  it.
- **No Next.js, no Redis.** Decided on build memory and on service count. See
  STACK.md, *Why these choices*.
- **A metered read is spent before the code sees the post.** An X read costs
  more than classifying it. Budget guards and deduplication are correctness
  concerns, not features.
