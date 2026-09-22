---
id: US-299
title: Every open ticket is a GitHub issue, and closing the file closes it
type: chore
priority: p2
created: 2026-09-22T16:28+08:00
parent:
area: tooling
resolution:
---

## Context

Moving the backlog to GitHub Issues was considered on 2026-09-22 and
refused. The ticket id is named on 2,107 lines of code and in 105 commit
subjects; the same id series runs through the private cloud repository;
status moves with `git mv` in the commit that earned it; and an agent reads
a ticket with one file read, not a `gh` call. Issue numbers are per
repository, shared with pull requests, and already collide with the ids.

What Issues have that the files do not is a door: a stranger can open one,
comment, and react. Postiz's tracker is 156 open issues of intake, and that
is where their users are. So the files stay the source, and Issues become
the public view of them — generated, like OPEN.md, never edited by hand on
the mirror side.

The rule for a request coming the other way (issue → ticket) is written in
US-294. This ticket is the script.

## Acceptance

- [ ] `backlog/sync.sh` opens one issue per ticket under `todo/` and
      `doing/` that has none, titled `US-123: <title>`, with the Context
      section as the body, a link to the ticket file at its `dev` path, and
      the `ticket` label. It writes the issue number back into the ticket's
      frontmatter as `issue:`, so the mapping lives in the file.
- [ ] A ticket whose file reaches `done/` or `parked/` has its issue closed
      by the next run: `done/` with resolution `shipped` closes as
      completed; `dropped`, `duplicate` and `parked/` close as not planned,
      each with one comment saying which.
- [ ] A ticket's title or Context change is pushed to the issue on the next
      run. Nothing flows the other way; a comment on the issue is for
      people, and the script never reads it.
- [ ] Ticket frontmatter gains an optional `labels:` list. The script sets
      those labels on the issue beside `ticket`, and removes ones the file no
      longer names. This is how `good first issue` reaches the mirror
      (US-296).
- [ ] `backlog/sync.sh --check` exits 1 when a `todo/` or `doing/` ticket has
      no issue or an issue's title does not match, and says which. CI runs
      it on `main` the way `index.sh --check` runs today; it does not run on
      pull requests, which have no token that can write.
- [ ] The script is idempotent: a second run with nothing changed makes no
      request that writes.
- [ ] backlog/README.md gains a section *The mirror on GitHub*: what is
      generated, what is not, and the rule that the file wins.
- [ ] `index.sh` is not changed except to read and ignore the two new fields.

## Notes

- The cloud repository is private and keeps its own tickets; this script
  runs in the open repository only. A cloud ticket has no public mirror.
- `gh issue create`, `gh issue edit`, `gh issue close --reason` and
  `gh issue list --label ticket --json number,title,state` are the whole
  surface. No API beyond what `gh` wraps.
- The body is the Context only. Acceptance and Log stay in the file, so
  an issue reader who wants them opens the link — and finds the reasoning
  in git, where it is versioned.
- The first run opens about thirty issues at once. Do it on a weekday
  morning and say in Discussions that it happened, so a watcher does not
  read it as thirty new bugs.

## Log

- 2026-09-22T16:28+08:00 — Written after the owner asked whether the backlog should move to Issues. It does not; the mirror does.
