---
id: US-118
title: One command puts the dev app on a link I can open anywhere
type: feature
priority: p2
created: 2026-09-11T15:36+08:00
parent:
area: developer experience
resolution: shipped
---

## Context

**The person who owns this product cannot see it while away from the laptop.**
The dev app answers on `localhost`, and a phone on another network reaches
nothing. Reviewing a screen meant pushing to `staging`, which builds an image
and waits for CI: four to five minutes per look, measured across the last five
`Deploy staging` runs. That is a fine number for a deploy and a poor one for
"is this button in the right place".

**Staging is still the right tool for anything real.** It runs the built image
on the box, behind a certificate terminated by our own Traefik, so no third
party ever sees plaintext. The preview is the other half: fast, disposable, and
trusted less. Nothing about this ticket changes what staging is for.

**The shape was proved by hand on 2026-09-11 before it was written down.** A
Cloudflare quick tunnel, a password in front of it, and the Vite dev server
behind it, with hot reload arriving over the tunnel's websocket. What that hour
found, and what the script must therefore do:

- **Vite refuses a `Host` it does not know.** `server.allowedHosts` does not
  contain the tunnel's random name, and the name changes every run, so it can
  never be listed in `apps/web/vite.config.ts`. The proxy rewrites `Host` and
  `Origin` to `localhost` instead, which keeps the preview out of that file.
- **Vite's own `/api` proxy is the wrong target.** It points at port 3000 —
  the developer's own API, whose `AUTH_URL` is `localhost:5173`. Better Auth
  then refuses the login from the tunnel's origin. The preview needs its own
  API process whose `AUTH_URL` is the tunnel address, and the proxy must route
  `/api` there itself.
- **Without websocket upgrades the page loads and then never updates.** That
  failure looks like nothing at all: no error, no console message, just a
  screen that quietly stops matching the code.
- **`__HMR_PORT__` is `null` when `server.hmr` is unset**, so Vite's client
  dials the page's own host and port — 443 through the tunnel. This is why hot
  reload needs no config change at all.

**The preview is public, so it gets the second lock.** A password sits in front
of everything, which is the same decision US-106 made for staging and for the
same reason: the app's open paths — the UI files, `/api/health`,
`/api/auth-status`, `/api/auth/*` — would otherwise answer a stranger. The
preview also sets `AUTH_SIGNUP=closed` regardless of `.env`, so nobody who
finds the address may register.

**The preview must never poll.** A poll spends real money at a real provider,
and a window onto the UI has no reason to start one. The worker is not started
and `WORKER_IN_PROCESS` is false.

## Acceptance

- [x] `pnpm preview` starts the whole chain and prints one link, a user and a
      password.
- [x] A request with no password, or the wrong password, is refused with 401.
- [x] A request with the password reaches the Vite dev server, and the app's
      login screen renders.
- [x] `/api/...` reaches the preview API, and `/api/auth-status` answers
      `signUpOpen: false` even when `.env` says `AUTH_SIGNUP=open`.
- [x] A closed route with the site password but no session answers 401.
- [x] The HMR websocket completes its handshake through the tunnel, and an edit
      to a component reaches the browser without a rebuild.
- [x] No worker starts, and no poll runs.
- [x] Ctrl-C stops the tunnel, the API, Vite and the proxy, leaving nothing
      listening.
- [x] A missing `cloudflared` is reported with the command that installs it,
      and the script does not download anything itself.
- [x] A port already held is reported in one sentence, naming every busy port,
      before Postgres or a tunnel is touched.
- [x] A run that fails part-way leaves nothing behind: no tunnel, no port held,
      and no message claiming a preview is live.
- [x] Ctrl-C prints no error. A deliberate stop is not reported as a failure.
- [x] The pure parts — the password comparison, the path routing, the header
      rewrite, and reading the address out of the tunnel log — have tests in
      `scripts/preview.test.mjs`.
- [x] `.env` is not edited. `pnpm dev` on 3000 and 5173 keeps working beside
      the preview.

## Notes

- `scripts/dev.mjs` is the shape to follow: read `.env`, put overrides over the
  top, spawn children.
- `vitest.config.ts` already includes `scripts/**/*.test.mjs`.
- `cloudflared` install: a single binary, no root and no account.
  `curl -sSL -o ~/.local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x ~/.local/bin/cloudflared`
- Ports: 3099 the proxy, 3100 the preview API, 5174 Vite. Chosen to sit beside
  `pnpm dev` rather than replace it.
- Cloudflare terminates TLS at its edge, so it can read the traffic there.
  Every leg is encrypted — the tunnel itself runs over QUIC — but this is a
  trust decision, not only a transport one. It belongs in the README line, so
  nobody puts customer data through it by accident.
- A quick tunnel's address is random and changes each run. A stable name needs
  the domain on Cloudflare DNS, and `signalscout-dev.space` is on Namecheap.

## Log

- 2026-09-11T15:36+08:00 — Written, after the shape was proved by hand over a
  live tunnel: password refused and accepted, login completed, `101 Switching
  Protocols` on the HMR socket, and an edit to `Login.tsx` seen on a phone.
- 2026-09-11T15:47+08:00 — Built and proved against a live tunnel. The suite
  passes: 113 files, 1942 tests, with 20 new ones in `scripts/preview.test.mjs`.
  Lint and typecheck pass.

  Two bugs the hand-run could not have found, both about process handling:
  `createWriteStream` has no descriptor yet when `spawn` reads it, so the
  tunnel's log had to be an `open()` descriptor instead; and `pnpm` spawns
  `sh`, which spawns `tsx` and `vite`, so SIGTERM to the child left the
  servers holding 3100 and 5174. Each child now gets its own process group and
  the stop escalates to SIGKILL. Verified after the fix: all three ports free,
  nothing left in the tree, and `pnpm dev` on 3000 and 5173 untouched.

  Measured against the live address: 401 with no password and with a wrong
  one, 200 with it, `signUpOpen: false` while `.env` says `AUTH_SIGNUP=open`,
  401 on `/api/projects` with the site password but no session, `101 Switching
  Protocols` on the HMR socket, and `hmr update /src/Login.tsx` after an edit.
  The process tree holds exactly cloudflared, the API and Vite — no worker.

  **Two boxes are unticked on purpose.** Both halves that need a browser — the
  login screen rendering, and an edit appearing without a reload — were proved
  on the hand-built chain earlier today, on the same proxy code, and are proved
  here only as far as HTTP goes. They stay open until somebody opens the link
  that `pnpm preview` printed.
- 2026-09-11T17:12+08:00 — Two changes after using it. `PREVIEW_PASS` is read
  from `.env`, so the address changes every run but the password need not; the
  shell still wins over the file, because a value typed in front of the command
  is meant for that run only.

  And the preview API no longer runs `tsx watch`. A watcher restarts its child
  into a process group of its own, which the stop cannot reach: after an edit,
  Ctrl-C left an API holding 3100 and the next run could not start. Found by
  watching a survivor's PGID differ from the group that was signalled. The
  preview does not need a watching API — Vite gives the hot reload this exists
  for — so an API change means restarting the command. Verified from a clean
  slate afterwards: one `cloudflared` while running, none after, all three
  ports free, nothing left in the tree.
- 2026-09-11T17:41+08:00 — The owner ran `pnpm preview` while an instance of
  mine was already up, and got three EADDRINUSE stacks instead of a sentence.
  Worse: each failed start left its tunnel running, because every child is
  detached and the crash skipped the stop. Three orphaned tunnels had
  accumulated.

  Three fixes. The ports are checked before anything starts, and all three are
  named at once — a person who frees one port, runs, and reads the next
  complaint has been told the truth three times slowly. `fail()` now takes the
  children down before it exits, through the same stop path Ctrl-C uses.
  `startProxy` rejects on a listen error instead of throwing an unhandled
  event, which used to kill the script where it stood and leave the tunnel.

  Making `fail()` async found a fourth: two call sites did not await it, so the
  script printed the failure and carried on to announce `Preview is live` with
  `null` as the address. Every call site awaits it now, and the two in
  callbacks say `void` to show the choice was made.

  Proved by running it twice at once — second run refused in one sentence, no
  tunnel started — and with a fake `cloudflared` that never reports an address:
  one message, exit 1, nothing left listening, no false claim. Suite at 1945
  tests, 113 files, including three on the port check.
- 2026-09-11T17:45+08:00 — Ctrl-C printed `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`
  and `Command failed with signal "SIGTERM"`: an error message for the stop
  working correctly. `pnpm` reports a child it did not stop itself as a failure,
  so the fix is to drop the wrapper — the preview now spawns
  `node_modules/.bin/tsx` and `apps/web/node_modules/.bin/vite` directly. That
  also removes two processes per child between the script and the server, which
  is what made the earlier `tsx watch` group problem possible at all.

  Proved from a clean baseline: no tunnel and no port before, one tunnel and
  three ports while running, none of either after Ctrl-C, and the last line
  printed is the API's own `shutting down`.

  One line in the output looks like a fault and is not: the API logs `no built
  UI found; serving the API only`. Correct here — Vite serves the UI and the
  proxy sends it everything that is not `/api`.
- 2026-09-11T17:52+08:00 — The owner ran `pnpm preview` on their own machine,
  reached it from a phone, signed in, and saw an edit arrive live. That closes
  the last two boxes, which were the halves no HTTP check can prove. Shipped.
