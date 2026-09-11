# SignalScout

**Open-source AI intent monitoring.** Find the people publicly talking about
the problem your product solves.

Traditional social listening answers *who mentioned my brand*. SignalScout
answers a different question:

> Who is publicly describing a problem my product can solve?

You describe what you sell, who buys it, and what problems you solve.
SignalScout searches Reddit, X, LinkedIn, YouTube, TikTok and Instagram — posts
and the comments underneath them — and uses a model to read each conversation
and score it: relevance, problem fit, ICP fit, buyer intent, urgency. What you
get is not a dashboard. It is an inbox of people who might need what you build.

---

## How it works

```
Reddit    ─┐
X         ─┤
LinkedIn  ─┤
YouTube   ─┼─► posts and comments ─► keyword ─► embedding ─► triage ─► scoring
TikTok    ─┤                             the three cheap stages    the good model
Instagram ─┘                                                                 │
                                                     relevance · ICP · intent
                                                                             │
                                                                     lead score
                                                                             │
                                  ┌─────────┬─────────┬─────────┬────────────┐
                                inbox     email    webhook     CSV         draft
```

**The cheap stages matter.** A post has to match a word, then clear a
similarity threshold, then survive a one-word question from a cheap model,
before the good model is paid to read it. On keyword noise that removes most of
the bill. Inside a topical subreddit it removes almost nothing, because
everything there is already about the subject — so the arithmetic on the
monitor form assumes the expensive case.

**Nothing is posted from here.** A match has a *Draft reply* button that asks a
model once and puts the text in a box with a copy action. Publishing to a
social network is on PLAN.md's *not building* list, and the feature ends at the
clipboard.

---

## Your accounts, your keys, your data

SignalScout ships the integrations. You own the accounts. Nothing is proxied
through us, and no data leaves your instance.

Six platforms arrive through five data providers — Bright Data, ScrapeCreators
and SocialCrawl for Reddit, SocialCrawl and SocialData for X, Apify for
LinkedIn, and SocialCrawl for YouTube, TikTok and Instagram. You bring a key
for the providers you actually use, and one Reddit key plus one model key is
already a useful product. Bright Data, ScrapeCreators and SocialCrawl each have
a free tier that needs no card.

A key lives in `.env`, where it belongs to the machine, or on a screen, where
it is tested with the provider before it is stored and belongs to the account
that pasted it. The model is yours to choose too — OpenAI, Anthropic, Google,
OpenRouter or Ollama, in three lines and no code path per provider.

Read [docs/self-hosting.md](docs/self-hosting.md) for which variable is which,
and [docs/secrets.md](docs/secrets.md) for what encryption promises.

### What it costs

**The money is spent at fetch time**, before any filter sees the text. So every
monitor has a monthly cap, every query can be cost-tested before it runs, and
the app shows what it spent.

Roughly: a Reddit post costs $0.0003 to $0.0015 depending on the provider, an X
post $0.0002, a LinkedIn post $0.002, and classifying one about $0.001 on a
cheap model. Instagram is the outlier, because its leads are in the comments
and a comment page is five credits — one live poll spent five times more with
the provider than with the model.

Every figure the app shows is an estimate. [docs/costs.md](docs/costs.md) has
the price of every connector and the six ways that arithmetic is wrong.

---

## Why it goes through data providers

Reddit closed self-serve API registration in November 2025, and getting a
client id now means a manual approval that small projects report being refused.
X's own API sells the same searches at $0.005 per post read with no free tier.
The other four platforms have no path that gives a small self-hosted tool a
keyword search over strangers' posts.

So every platform arrives through a data provider, and you bring that
provider's key. **Be clear about what that means**, because it is not a free
pass. Your data arrives through a company that is not the platform. You sign
that company's agreement instead of the platform's, and that agreement puts the
compliance burden on you: you warrant that your use violates no third party's
rights, and you indemnify them if it does. The question of whether commercial
monitoring is allowed did not go away. It moved onto you, and it became less
visible.

We think that is the honest trade for an open-source tool, and we would rather
say it here than let you find it in an agreement you skimmed.

[STACK.md](STACK.md) has the measurements behind each choice, and
[docs/sources.md](docs/sources.md) has what each connector can and cannot do.

---

## Running it

```bash
git clone https://github.com/rszhd/signalscout
cd signalscout
pnpm setup                # writes .env from .env.example.self-hosted,
                          # and the two secrets it cannot ship
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

The app is then on <http://localhost:3000>. It asks you to make the first
account, and refuses every registration after it. One Postgres and one Node
process, designed for a 1 GB VPS.

**Put it behind TLS before you give it a public address.** It holds provider
keys that spend money and an inbox of your own research.

[docs/self-hosting.md](docs/self-hosting.md) is the whole install: the two
secrets and why they are not in the file you copied, the proxy, the settings
that decide whether this instance takes registrations, and the SQL for finding
out why a monitor stopped finding things.

---

## What this is not

No sentiment charts, no share of voice, no word clouds, no competitor
analytics, no social publishing, no CRM. Those are good products. They are not
this one.

The scope is one sentence: **find conversations with intent.**

---

## Repository

| | |
|---|---|
| [PLAN.md](PLAN.md) | What we are building, and why |
| [STACK.md](STACK.md) | What we are building it with, and why not the alternatives |
| [docs/self-hosting.md](docs/self-hosting.md) | The whole install: secrets, TLS, settings, troubleshooting |
| [docs/sources.md](docs/sources.md) | Adding a platform, adding a provider, switching one off |
| [docs/costs.md](docs/costs.md) | What our spend figure is, and what it is wrong about |
| [docs/secrets.md](docs/secrets.md) | Where a key lives, what encryption promises, how to rotate |
| [docs/accounts.md](docs/accounts.md) | Accounts, TLS, verifying an address by hand, getting back in |
| [docs/billing.md](docs/billing.md) | Who is entitled, what a refused write answers |
| [docs/notifications.md](docs/notifications.md) | SMTP setup and the webhook contract |
| [docs/deletions.md](docs/deletions.md) | How a removed post stops being shown |
| [docs/design.md](docs/design.md) | The shared theme, tokens and controls |
| [docs/spacing.md](docs/spacing.md) | The spacing scale |
| [docs/testing.md](docs/testing.md) | How the tests are written, and what a green suite cannot say |
| [docs/instruments.md](docs/instruments.md) | Every command that spends money, what it asks and what it costs |
| [docs/history.md](docs/history.md) | What each ticket measured, in the order it happened |
| [backlog/](backlog/README.md) | One ticket per file; the folder is the status |
| [AGENTS.md](AGENTS.md) | Instructions for AI coding agents working in this repo |

---

## Contributing

The most useful contribution is a source connector. Every source implements one
interface, so adding Hacker News, Bluesky, Mastodon or a forum means one folder
and one registry entry. [docs/sources.md](docs/sources.md) has both lists — a
new provider for a platform we already fetch, and a new platform.

**Not yet, though.** PLAN.md holds one rule above the others:

> Do not add another social network until Reddit and X reliably produce useful
> matches.

A product with two sources that surfaces five genuinely valuable conversations a
day beats one with twenty sources generating hundreds of noisy alerts. Help with
detection quality first.

Six platforms are in the build, and the rule has been crossed four times — each
one on the owner's decision, each one recorded in its ticket rather than left
to look like an oversight. It is still the rule, and a pull request adding a
seventh source meets this same answer.

If you use an AI coding agent, read [AGENTS.md](AGENTS.md) before starting.

---

## License

[Apache-2.0](LICENSE). Use it, change it, run it inside your company, sell a
service built on it. The license adds an express patent grant, which MIT does
not have.

Copyleft was considered and refused, and the reason is worth stating rather than
implying: this product's moat is convenience and not code. The hosted version
charges for not running a server, not for features the self-hosted build lacks,
so a network clause would protect nothing — while many companies ban AGPL
software by policy, which would shut out the exact people meant to be running
this. The argument in full is in
[US-019](backlog/done/2026-09/US-019-the-project-has-a-license.md).

Contributions come in under the [DCO](CONTRIBUTING.md): one `Signed-off-by`
line, no paperwork.
