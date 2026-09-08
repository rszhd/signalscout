---
id: US-081
title: An open instance does not share the machine's keys
type: feature
priority: p1
created: 2026-09-09T02:50+08:00
parent: US-067
area:
resolution: done
---

## Context

US-067 gave every account its own provider keys in the database and left the
environment half alone, because an environment variable belongs to the machine
and that is what makes `.env` the self-hosted path. It recorded the consequence
in prose: an instance with both a `.env` key and `AUTH_SIGNUP=open` lets a
stranger poll on the machine's key. docs/accounts.md said *empty the environment
before you open signup*.

Prose is not a rule. This makes it one: **where signup is open, the keys in
`.env` are not an account's to spend** — provider keys and model keys alike. A
signed-in person stores their own or the job does not run.

The self-hosted instance is unchanged, and that is the whole reason the rule is
tied to signup rather than applied everywhere. One person on their own machine
configuring it with a file is not the case this protects against.

## Acceptance

- [x] With signup open, a poll does not fall back to a provider key in `.env`
- [x] With signup open, a model call does not fall back to a key in `.env`
- [x] The provider, model, endpoint and prices in `.env` still apply — only
      keys stop travelling
- [x] The connections screen shows an environment key as absent, so the monitor
      form refuses rather than a poll failing later
- [x] The Models screen offers no "this instance's key"
- [x] With signup closed, nothing changes
- [x] No screen offers a fallback to the machine that the machine cannot serve

## Notes

- `config/machine-keys.ts` is the whole rule: `machineKeysUsable`,
  `withoutMachineModelKeys`, `providerKeyEnvironment`. One decision, asked once
  per composition root, and every layer below is handed an environment with the
  keys already gone — so nothing downstream needs a branch or a reason.
- **Only the keys are removed.** The provider, the model, the base URL and the
  prices are what a deployment was configured and measured for, and an account
  with no settings of its own should keep them.
- The API applies it in `server.ts`, once for the provider keys and once for
  the model environment. The worker applies it in `runtime.ts` — the half that
  spends without anybody watching.
- `loadSignupEnv` exists so the worker can ask this without parsing a whole
  `DATABASE_URL` to find out.
- One test names every `_API_KEY` in the result rather than sampling three,
  because a key variable added later is one the stripper would silently pass
  on, and the failure is invisible: a stranger's poll simply works, on somebody
  else's account.

## Log

- 2026-09-09T03:00+08:00 — Built. 1,551 tests pass, lint and typecheck clean.

  **Unproven:** no instance has run with `AUTH_SIGNUP=open` and a `.env` key to
  watch a poll refuse. The suite covers our half — the lookup, the overlay and
  both screens — and a live run is what would show what a person actually sees
  when a monitor stops for this reason.

- 2026-09-09T03:45+08:00 — **The Models screen still offered "Use instance
  defaults" where there is no instance key to fall back to.** The route was
  right and the screen was not: clearing a job hands it back to the
  deployment's provider, model and key, and where signup is open there is no
  key at the end of that — so the button offered a job that cannot run and
  called it a default.

  It is now offered only where the instance holds a key for that job, and the
  section's own sentence changes with it: *This instance holds no keys of its
  own, so a job with none chosen does not run.* The old wording promised a
  fallback and would have sent somebody away from the page thinking they had
  finished.

  The lesson is this ticket's own and I had already written half of it: a rule
  enforced in the routes is not a rule until every screen stops offering what
  it refuses.
