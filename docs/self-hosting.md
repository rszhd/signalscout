# The self-hosted install, for the people who change it

> **Running SignalScout rather than changing it?** The install guide is at
> [docs.signalscout.run/self-hosting](https://docs.signalscout.run/self-hosting/);
> its source is [`site/self-hosting/`](../site/self-hosting/index.md). This page
> holds the rules behind that install, for a contributor.

The install is two files and the published image: `docker-compose.yml` and a
`.env` copied from `.env.example.self-hosted`. No git, no Node, nothing
compiled on the server (US-295). Every change below keeps that true.

---

## Adding a setting

**A setting is four edits, and a test fails for most you forget.**

1. The schema that reads it (`apps/api/src/config/env.ts`, or the pipeline's
   or the engine's).
2. `.env.example`, with the reason written beside it. The site's
   [configuration reference](../site/self-hosting/configuration.md) is
   generated from this file before every build, so this comment is the one
   users read. `env-example.test.ts` fails when a variable is missing.
3. The `environment` block in `docker-compose.yml`. A variable named nowhere
   there never reaches the container, whatever `.env` says, and
   `compose-environment.test.ts` fails.
4. `.env.example.self-hosted`, only if a self-hoster must set it. Everything
   absent from that file must default to the self-hosted answer, so the
   short file boots as it stands.

**Every default is the self-hosted answer** — `AUTH_SIGNUP=closed`,
`AUTH_EMAIL_VERIFICATION=off`. A version bump that silently began refusing
logins or writes is the upgrade no self-hoster forgives.

## The two secrets

`AUTH_SECRET` and `ENCRYPTION_KEY` are in neither example file, because both
are committed. `pnpm setup` (`scripts/init-env.mjs`) generates them and never
overwrites an existing value, so re-running it on an instance that already
holds encrypted rows is safe. It also warns while `POSTGRES_PASSWORD` is the
shipped default rather than replacing it: a new password on an existing
volume locks the app out of its own database.

## The image

`ghcr.io/rszhd/signalscout`, built by CI from `main` and published for
`linux/amd64` and `linux/arm64`. Tags: the full version, the minor version,
and `latest`. [releasing.md](releasing.md) says when each moves.

**The runtime stage is a production install and the compiled output**,
nothing else: no `tsx`, no source, no test files (BUG-338). So a command a
self-hoster runs inside the image must be a compiled script under `dist/`,
run with `node`. The key rotation is the example:
`node packages/pipeline/dist/secrets/rotate-cli.js`, not `pnpm db:rotate-key`.

**The `migrate` container runs to completion before `app` starts**
(`condition: service_completed_successfully`). A half-migrated database
serving requests is worse than one serving none, so a failed migration keeps
the app down on purpose. Going back is restoring the dump and pinning the old
version; the old image against a migrated database is not a state this
project tests.

**`app` has a healthcheck against `/api/health`; the worker has none**,
because it serves no port. Whether the worker works is a question about
polls, and `poll_runs` answers it (US-308).

## What the user guide promises

The site's self-hosting pages make promises that code keeps. Change the code
and the page in the same commit:

| The page says | The code that keeps it |
|---|---|
| A new monitor emails at 50 and up, immediately at 70 and up | `packages/pipeline/src/notifications/settings.ts` |
| A webhook signature is `v1=` and an HMAC of `timestamp.body` | `packages/pipeline/src/notifications/transport.ts` |
| A failed job retries five times over an hour, then dead-letters | `packages/pipeline/src/worker/queues.ts` |
| Three sign-in tries in ten seconds per address | Better Auth's rate limit, `apps/api/src/auth/auth.ts` |
| The rotation command above runs in the image | the Dockerfile's runtime stage |

---

## Working on the code

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts Postgres, applies the migrations, and runs the API on port
3000, the Vite dev server on 5173 and the worker as a third process. It calls
the same `.env` bootstrap `pnpm setup` does, so the two paths cannot drift.

`pnpm test` needs the same Postgres, because the tests use a real one. No test
reaches a provider or a model: the suite blanks `AI_API_KEY`, so a machine with
a key exported cannot spend one by accident. `pnpm lint`, `pnpm typecheck` and
`pnpm build` need nothing. [testing.md](testing.md) says how the tests are
written and what a passing suite cannot say.

The docs site builds on its own, outside the workspace:
`cd site && npm ci && npm run dev`. [`site/README.md`](../site/README.md) has
the rules for a page.
