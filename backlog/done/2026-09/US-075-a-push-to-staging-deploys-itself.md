---
id: US-075
title: A push to staging deploys itself
type: feature
priority: p1
created: 2026-09-08T19:57+08:00
parent: US-073
area: deployment
resolution: shipped
---

## Context

CI publishes an image and nothing takes it. `:staging` is a mutable tag, so a
running container keeps serving the digest it pulled until somebody runs `pull`
and `up -d` on the box. Every deployment so far has been those two commands
typed by hand, and the gap between "the build is green" and "the site is new"
has been however long it took somebody to notice.

**The failure is not that it is slow. It is that the site can be wrong and look
right.** On 2026-09-08 staging served the previous build for twenty minutes
after a green run, with nothing anywhere reporting a difference — no banner, no
log line, no unhealthy container. The only way to know was to compare the
running digest against the tag.

**A deploy moves more than the image.** Compose reads its YAML from the box, and
on that same day the box was running a new image against a compose file copied
before US-074 existed. `BILLING_MODE=stripe` sat in `.env`, the container never
received it, the instance booted in `off` mode, and every screen worked. So the
files and the image must move together, in one step, or the pair will drift
again.

**The neighbouring project on this box already solves this**, and its workflow
records the same two lessons under BUG-050 and US-048. Follow its shape rather
than inventing one: a reusable deploy called by a thin per-branch file, the
commit as the pin, and the push as the approval.

## Acceptance

- [x] A push to `staging` builds, publishes, and deploys, with no command typed
- [x] The deploy runs only after the checks pass, so a commit whose tests never
      ran cannot reach the box — a property of the job graph, not a convention
- [x] The compose files on the box come from the same commit as the image
- [x] The workflow asserts the box is serving the new digest afterwards, and
      fails when it is not
- [x] The deploy is repeatable by hand for a rollback, through
      `workflow_dispatch` with a ref
- [x] Two deploys cannot run at once, and a second is queued rather than
      cancelling the first

## Notes

- Three secrets: the deploy key, the known-hosts line and the host. The
  known-hosts line is pinned rather than accepted on sight, because accepting
  on sight is the whole of the protection SSH offers here.
- The image is public since 2026-09-08, so the box needs no registry
  credential. That is one fewer secret than the neighbouring project needs.
- `main` gets the same treatment when there is a production stack. There is
  none yet, so this ticket is staging only and the workflow must not learn
  which environment it is serving.

## Log

- 2026-09-08T19:57+08:00 — Written after being asked why the site was on the
  old build. The answer was that nothing had told the box to take the new one.
- 2026-09-08T20:22+08:00 — The workflow, the reusable CI call and
  `scripts/deploy-remote.sh` are written, and the script has been run four times
  against the real box.

  **It deploys by digest rather than by tag**, which turned out to be the whole
  of the assertion. The first version compared the registry's manifest digest
  with the box's `RepoDigests` and they disagreed — an index digest against the
  manifest inside it — so a correct deploy would have failed every time.
  Pinning `SIGNALSCOUT_IMAGE` to `repository@sha256:…` for the one command makes
  the container image id the digest itself, and the comparison exact.

  The rollback path is proven rather than described: the script was run with the
  previous digest, the box took it and the assertion passed, and then the
  current one was put back. `.env` on the box is never written, so the pin holds
  for one deploy and the file keeps saying which stream this box follows.

  Two boxes stay open until the secrets exist, because both are claims about a
  workflow run rather than about a script: the automatic trigger, and the
  ordering that stops an unchecked commit reaching the box.
- 2026-09-08T20:15+08:00 — The first automatic deploy ran. Push to serving took
  **2 minutes 49 seconds**: checks 1m46, image 40s, box 23s. The run asserted
  `sha256:b32cdd48…` and the box reported the same id, so the last two boxes are
  ticked against a workflow run rather than against the script.

  Three secrets were installed by the owner, because installing an authorized
  key and storing a private one are not things this session may do. The key and
  the pinned host key were both exercised before GitHub used them, which is why
  the first run had nothing to debug.
