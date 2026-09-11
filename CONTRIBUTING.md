# Contributing

Thank you for looking. This is a small project and a patch is welcome.

## The license, and how your work arrives

The project is [Apache-2.0](LICENSE), and contributions come in under the same
license.

There is no CLA. Instead the project uses the **Developer Certificate of
Origin**: you add one line to each commit saying you have the right to submit
the work.

```bash
git commit -s -m "Your message"
```

The `-s` adds:

```text
Signed-off-by: Your Name <your@email>
```

That line is the whole ceremony. It is not a copyright assignment and it gives
nobody rights over your other work. The full text of what you are certifying is
at [developercertificate.org](https://developercertificate.org/), and it is
short enough to read.

A CLA was considered and refused. It would let the project be relicensed later
without asking anybody, and that convenience is not worth deterring the people
this project wants patches from.

## Before you write code

**Find or write a ticket.** `backlog/OPEN.md` lists what is agreed and waiting.
A ticket's **Context** holds the reasoning the code cannot, and its
**Acceptance** list is what "done" means.

**Read [AGENTS.md](AGENTS.md).** It is the working agreement for this
repository — for people and for AI tools alike — and it holds the rules that
are easy to break by accident.

Four of them matter more than the rest:

- **`packages/core` imports neither Fastify nor React.** The API and the worker
  both call into it. If a change seems to need it, the change is wrong.
- **A red test is fixed in the code, not in the assertion.** An expected value
  moves only when the behaviour was meant to move, and the commit says which
  and why.
- **No test spends money.** Nothing in the suite reaches a social API or a
  model provider. `vitest.config.ts` blanks `AI_API_KEY` so a machine with a
  key exported cannot spend one by accident.
- **A fixture for somebody else's API is captured, never written.** A payload
  you wrote is evidence about our parser and none at all about the wire
  format. Instagram alone contradicted three of its provider's documented
  claims, and each would have shipped as a silent fault.

## Running it

```bash
pnpm install
pnpm db:up        # Postgres, which the tests need
pnpm dev          # Postgres, migrations, API, web and worker
pnpm preview      # the same app on a public link, for review from a phone
pnpm test         # needs the Postgres that db:up starts
pnpm lint         # Biome: formatting and lint rules together
pnpm typecheck
```

`pnpm preview` opens a Cloudflare tunnel to a second API and a second Vite, so
it runs beside `pnpm dev` rather than instead of it. It prints one link and a
password, hot reload included. It needs `cloudflared`, which it tells you how
to install; it downloads nothing itself.

The address is new every run — a stable one needs the domain on Cloudflare DNS.
The password does not have to be: set `PREVIEW_PASS` in `.env` and every run
uses it, so the phone that saved it does not ask again. `PREVIEW_USER`,
`PREVIEW_PROXY_PORT`, `PREVIEW_API_PORT` and `PREVIEW_VITE_PORT` work the same
way. A value typed in front of the command wins over the file.

Only Vite reloads. The API is started without its watcher, so a change under
`apps/api` or `packages/core` needs the command restarted.

Use it to look at screens, not for anything real. Cloudflare terminates TLS at
its edge, so it can read the traffic there, and a quick tunnel's address is
public to anyone who finds it — which is why a password sits in front and
registration is closed whatever `.env` says. Staging is the deployment whose
certificate nobody outside this project terminates.

`pnpm test` uses a real Postgres and creates a database per test file. If it
cannot reach one it says so; it does not fall back to a fake. It can go red
without a broken test, and *Running the suite* in
[docs/testing.md](docs/testing.md) says how to tell that apart from a
regression before you go looking for one.

## Adding a connector

[docs/sources.md](docs/sources.md) holds two lists: adding a *provider* and
adding a *platform*. They are different jobs. Read *What connectors get
wrong* before starting.

A new platform is also a product decision, not only a technical one. PLAN.md's
*Important rule* says no further network is added until the existing ones
reliably produce useful matches. It has been crossed four times, each on the
owner's decision and each recorded in its own ticket. It is still the rule.

## Commit messages

Under 300 words, subject and body together. The subject is a prose sentence.
The body holds only what the diff cannot say — the why, the constraint, the
decision that would otherwise be made twice. Do not list the changed files; the
diff already shows them.

## Reporting something

An issue that says what you expected, what happened, and how to reproduce it is
worth more than a patch that guesses. If it touches money, a provider's
behaviour or a credential, say what you measured and what you inferred — this
repository keeps those apart on purpose.
