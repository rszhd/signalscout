# Security

## Reporting

**Report privately, through a
[GitHub Security Advisory](https://github.com/rszhd/signalscout/security/advisories/new).**
Not in an issue, not in Discussions, not in a pull request. A public report
tells every reader of this repository about the hole before there is a
version that closes it.

**A report says what you reproduced, and how.** The steps, the version, and
what you observed. A report that a tool wrote and nobody ran costs a
maintainer an evening and its sender nothing; this rule is what makes it cost
something. A report with no reproduction is closed with that sentence, and
you are welcome to send it again with one. See [AI_POLICY.md](AI_POLICY.md).

Expect a first answer within a week. This is a small project and there is no
team behind it — [AI_POLICY.md](AI_POLICY.md) says plainly who reads the code.

## What is in scope

- The application in this repository: `apps/api`, `apps/web`, the worker.
- The published packages `@signalscout/engine`, `@signalscout/pipeline` and
  `@signalscout/ui`.
- The published image `ghcr.io/rszhd/signalscout`.
- The install as the documents describe it, including the compose files.

## What is not

- **An instance you configured differently from the documents.** Serving the
  app without TLS, or with `AUTH_SIGNUP=open` where you did not mean it, is a
  deployment choice. [The self-hosting guide](https://docs.signalscout.run/self-hosting/)
  says what each setting admits.
- **A data provider's platform, or a model provider's.** Their keys are in
  your instance and their agreements are yours. Report to them.
- **SignalScout Cloud**, which is a separate product on separate servers.
  Report those through the same advisory form and say it is the hosted one.
- Anything needing an attacker who already holds `ENCRYPTION_KEY`,
  `AUTH_SECRET` or database access. Those are the trust boundary, not a
  target inside it ([docs/secrets.md](docs/secrets.md)).

## Supported versions

The latest tag, and nothing else. A fix lands on `main` and goes out in the
next release rather than as a patch to an old number; there are not enough
users yet for a branch per version, and pretending otherwise would be a
promise nobody keeps.

## What the application holds

Say this to yourself before you give an instance a public address. It stores
provider keys that spend real money, encrypted with `ENCRYPTION_KEY`; an
inbox of commercial research that says what you sell and who you think buys
it; and the accounts that can read both. That is the reason the process
refuses to start without `AUTH_SECRET`, and the reason the README asks for
TLS in bold.
