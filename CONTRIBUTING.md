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
  format. This has caught four documented provider claims wrong in one month.

## Running it

```bash
pnpm install
pnpm db:up        # Postgres, which the tests need
pnpm dev          # Postgres, migrations, API, web and worker
pnpm test         # needs the Postgres that db:up starts
pnpm lint         # Biome: formatting and lint rules together
pnpm typecheck
```

`pnpm test` uses a real Postgres and creates a database per test file. If it
cannot reach one it says so; it does not fall back to a fake. It can go red
without a broken test — a database per file outruns Postgres's default
connection limit — so try `pnpm vitest run --maxWorkers=3` before reading a red
run as a regression.

## Adding a connector

[docs/sources.md](docs/sources.md) holds two lists: adding a *provider* and
adding a *platform*. They are different jobs. Read the three things connectors
get wrong before starting.

A new platform is also a product decision, not only a technical one. PLAN.md's
*Important rule* says no further network is added until the existing ones
reliably produce useful matches, and the two crossings of that rule so far are
both recorded as deliberate decisions.

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
