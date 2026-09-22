---
id: US-308
title: The app container says whether it is alive
type: bug
priority: p3
created: 2026-09-22T19:00+08:00
parent:
area: deployment
resolution: shipped
---

## Context

`docker-compose.yml` gives Postgres a healthcheck and gives the app none.
`/api/health` exists and is registered before the session gate, so it answers
without a cookie — nothing uses it.

So `docker compose ps` reports `Up` for an app process that has stopped
answering, which is the state a self-hoster most needs to see and the one
they cannot. `restart: unless-stopped` restarts a process that exited and
does nothing for one that is alive and wedged.

## Acceptance

- [x] The `app` service has a healthcheck calling `/api/health` on its own
      port, with an interval, a timeout, retries and a `start_period` that
      covers a cold boot behind the migrate container.
- [x] It uses something the image already has. If neither `curl` nor `wget`
      is in it, the check is `node -e` against `http://127.0.0.1:${PORT}` —
      adding a package to the image for a healthcheck is the wrong trade.
- [x] `docker compose ps` shows the app `healthy`, and shows it `unhealthy`
      when the process is wedged. The Log says how that second state was
      produced.
- [x] The `worker` service gets the same treatment or an explicit note in the
      compose file saying why it cannot have one.
- [x] docs/self-hosting.md's troubleshooting section names
      `docker compose ps` as the first thing to read.

## Notes

- `PORT` is configurable, so the check reads it rather than hard-coding 3000.
- `/api/health` is listed in `apps/api/src/auth.ts` among the routes that skip
  the session gate; check that is still true before relying on it.

## Log

- 2026-09-22T19:00+08:00 — Written after finding a healthcheck on Postgres and none on the app, with the route already there.
- 2026-09-22T19:20+08:00 — Shipped. The check is `node -e` with global `fetch`, because the image has neither curl nor wget and adding a package for a healthcheck is the wrong trade. It reads `PORT` rather than assuming 3000. `start_period` is 20s and covers the Node process only, since the migrate container has already run to completion before this one starts.
- 2026-09-22T19:20+08:00 — Proved on a stack built from the published image. Healthy after 7 seconds. Then `docker pause`, which freezes the container while leaving it running — the exact state `restart: unless-stopped` cannot see — and after three failed probes it read `paused / unhealthy`. `docker unpause` returned it to `running / healthy` without intervention.
- 2026-09-22T19:20+08:00 — The first attempt to produce that state sent `SIGSTOP` to PID 1, through `docker exec` and then `docker kill --signal`. Neither took: five probes in a row exited 0 and the container stayed healthy. `docker pause` is the one that works, because it freezes the whole cgroup including the process the healthcheck execs. Worth knowing before testing a healthcheck again.
- 2026-09-22T19:20+08:00 — The worker gets a comment in the compose file, not a check. It takes jobs from pg-boss and serves no port, so there is nothing to ask it; docs/self-hosting.md's *When a monitor stops finding things* is where that question is answered, and it now names `docker compose ps` as the first thing to read.
