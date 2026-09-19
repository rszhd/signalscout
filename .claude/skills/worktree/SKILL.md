---
name: worktree
description: Make or remove a git worktree that runs the whole stack on ports of its own with a copy of the database. Use when work must run beside the main checkout, or when a second agent works in parallel.
---

# A worktree

1. `node scripts/new-worktree.mjs <name>` — from the main checkout. It
   creates `worktrees/<name>` inside the checkout, gives it a slot (API,
   Vite and Postgres ports derived from one number), writes its `.env`, and
   seeds a copy of the main database.
2. **Every monitor in the copy is paused.** Unpause one on purpose if you
   need a poll; a worker in a folder nobody watches will bill.
3. Work there. `pnpm test` reads that folder's `.env`, so two suites can run
   at once without crossing `max_connections`.
4. Migration numbers are shared with every other worktree: check
   `ls packages/pipeline/drizzle | tail -3` before committing one.
5. Remove with `node scripts/remove-worktree.mjs <name>`, never with
   `git worktree remove`: git leaves the container, the network and the
   volume behind. Neither command deletes a branch.

Never seed a worktree by copying `.env` by hand: two folders on one port
migrate one database.
