# Project Plan

## What we’re building

An **open-source AI intent monitoring tool** that watches social platforms and surfaces conversations from people who may actually need what you sell.

Instead of traditional social listening focused on brand mentions, sentiment, dashboards, and analytics, this project focuses on one question:

> Who is publicly talking about a problem my product can solve?

The first version focused on **Reddit and X/Twitter**. Six platforms are
monitored now — see *Sources* below, and *Important rule* for how that
happened.

---

## Core idea

Users describe:

* What their product does
* Who their ideal customer is
* What problems they solve
* What kinds of buying signals they care about

The system continuously searches connected social platforms, collects candidate posts, and uses AI to evaluate each conversation.

Example:

**Product**

AI browser QA agent for SaaS teams.

**Ideal customer**

Small SaaS teams without dedicated QA resources.

**Problems**

* Repetitive manual QA
* Maintaining brittle E2E tests
* Regression testing taking too much developer time
* Looking for easier QA automation

The system might find:

> “We're only three developers and manually test signup and checkout before every release. What are other small teams using?”

And score it:

* Relevance: 98
* Problem fit: 96
* ICP fit: 91
* Buyer intent: 88
* Urgency: 82

Instead of alerting on every keyword match, AI filters the noise and surfaces the conversations that actually matter.

---

# Philosophy

## Open source first

The complete application should be self-hostable.

Users should be able to:

```bash
git clone ...
docker compose up
```

and run the entire system themselves.

The open-source version should not be artificially crippled to force people onto the paid version.

---

## Bring Your Own Keys

Users provide their own credentials for external services.

For example:

```env
BRIGHTDATA_API_KEY=      # Bright Data — Reddit
SOCIALCRAWL_API_KEY=     # SocialCrawl — Reddit, X, YouTube, TikTok, Instagram
APIFY_API_TOKEN=         # Apify — LinkedIn

AI_API_KEY=
```

**No platform is reached through its own API, and that is not what was
planned.** Reddit closed self-serve registration in November 2025 and X sells
pay-per-use with no free tier, so every platform arrives through a data
provider and the key a person brings is that provider's. A variable is named
after the provider rather than the platform, because one key can serve five of
them.

The principle is unchanged: the user owns the account and pays for their own
usage. STACK.md, *A source is not a provider*, holds the reasoning and the rule
it produced, and docs/self-hosting.md lists every variable.

Several AI providers are supported:

* OpenAI
* Anthropic
* Gemini
* DeepSeek
* OpenRouter
* Ollama
* OpenAI-compatible local models

The same philosophy applies to social networks.

We provide the integration.

The user controls the account, API access, usage, and associated API costs.

---

# Sources

Six platforms are monitored, through ten connectors — of which nine are
offered, because a connector can ship and not be offered. Reddit and X came
first, and the signals they carry are written out below. STACK.md holds what
the economics of a source do to the build, docs/sources.md holds what each
connector can and cannot do, and docs/history.md records what each one has been
measured doing.

## Reddit

Monitor relevant posts and comments.

Useful signals include:

* Asking for recommendations
* Looking for alternatives
* Complaining about an existing tool
* Describing a recurring problem
* Comparing solutions
* Asking how other companies solve something
* Looking to hire someone to solve the problem

## X / Twitter

Monitor real-time conversations around similar signals.

Especially useful for:

* Founder complaints
* Product recommendations
* Tool-switching conversations
* Requests for help
* Competitor frustration
* New problems being discussed in real time

---

# Monitoring flow

```text
Reddit ─────┐
            │
X ──────────┤
            │
            ▼
      Candidate posts
            │
            ▼
      Cheap pre-filter
            │
            ▼
      AI intent engine
            │
       ┌────┼────┐
       │    │    │
       ▼    ▼    ▼
 Relevance ICP  Intent
       │    │    │
       └────┼────┘
            │
            ▼
       Lead score
            │
            ▼
         Matches
            │
     ┌──────┼──────┐
     ▼      ▼      ▼
 Dashboard Email Webhook
```

---

# Intent classification

The AI should not merely decide whether a post is related to a keyword.

It should understand the context.

For example:

### Low intent

> “Playwright is awesome.”

Intent: 3/100

### Mild problem signal

> “Our Playwright tests break whenever the UI changes.”

Intent: 50/100

### Strong intent

> “Our Playwright suite is becoming impossible to maintain. Is there something easier?”

Intent: 90/100

### Very strong intent

> “We're a four-person SaaS and still manually test signup and checkout every release. What tools are other small teams using?”

Intent: 96/100

Possible classification fields:

```json
{
  "relevance": 98,
  "problemFit": 96,
  "icpFit": 91,
  "intent": 88,
  "urgency": 82,
  "intentType": "recommendation_request",
  "reason": "Small SaaS team explicitly describing repetitive manual QA and asking for solutions."
}
```

Possible intent types:

```text
none
problem
recommendation_request
alternative_search
competitor_complaint
comparison
purchase
hiring
```

---

# Product UX

Avoid building a traditional social-listening analytics dashboard.

Read [docs/design.md](docs/design.md) before changing a screen. New screens
should feel like the same product through their navigation, typography,
spacing, colour and responsive behaviour. Real product behaviour and ticket
acceptance stay authoritative, and a control does not appear in the
application until the behaviour behind it exists.

No need initially for:

* Sentiment charts
* Share of voice
* Word clouds
* Competitor analytics
* Complex reports

The core product should be an **intent inbox**.

Example:

```text
🔥 94 HIGH INTENT

Reddit · r/SaaS · 12 minutes ago

"How are small teams handling regression
testing? We're manually checking our major
flows before every release."

What the model saw

• Small SaaS team
• Explicit manual-testing pain
• Asking for solutions
• Current problem

Problem fit       98
ICP fit           91
Intent            94

[Open conversation]
[Draft reply]
[Not relevant]
```

The heading was "Why it matched", with a tick on every claim. That is right
for the 94 above and wrong for a 31. The classifier is asked for claims about
the post, not for support for its own score, so on a weak post it writes what
it saw and some of it is negative: "the post does not ask for a tool" is one
of the most useful lines on the card, and a green tick beside it is a lie
about what the model said.

So the claims are neutral, and the score above them says how it went. A
heading that only reads correctly on a good match hides exactly the matches a
person most needs to dismiss quickly.

The experience should feel like:

> An inbox of people who might need your product.

Not:

> A social-media analytics dashboard.

---

# Monitor creation

Creating a monitor should be simple.

## Product

What do you sell?

## Ideal customer

Who is most likely to buy it?

## Problem

What problem does it solve?

## Signals

What should the system look for?

```text
☑ Asking for recommendations
☑ Looking for alternatives
☑ Complaining about current solution
☑ Describing the problem
☑ Comparing products
☑ Looking to purchase
☑ Looking to hire someone
```

The system can generate underlying search queries automatically.

Users should not need to become Boolean-search experts.

---

# Feedback loop

Every result should allow:

```text
👍 Good match
👎 Not relevant
```

Over time these examples can improve intent classification for each user.

Different businesses consider different things valuable.

The long-term goal is for the system to learn:

> What does this particular user consider a good lead?

---

# Architecture

Keep integrations modular. The shape the repository actually took is in
STACK.md, *Repository shape*; what matters here is the seam.

Social networks should implement a common connector interface.

The sketch this plan started from was three members: an id,
`validateCredentials` and `search`. US-003 settled the real one, and it is
wider, because three facts about billing and throttling were missing here and
each one, left out, ends up copied into the worker: a page carries a cost as
well as a cursor, back-off belongs to the connector, and a source declares its
own price. `packages/core/src/sources/types.ts` is the interface, and its
comments say why each member exists.

This makes additional integrations easy for both us and community contributors.
See [docs/sources.md](docs/sources.md) for the steps.

---

# Future integrations

Do not build these until the existing sources are working well. YouTube,
TikTok and Instagram have since been built, each as a recorded decision — see
*Important rule*.

Potential sources:

* Hacker News
* Bluesky
* Mastodon
* Threads — parked in US-038, and the only one of that ticket's three still parked
* RSS
* GitHub
* Stack Overflow
* Discourse
* Facebook
* Other forums and communities

Community pull requests should be encouraged for new connectors.

---

# Cloud version

The open-source project remains free and self-hostable.

**It is live.** SignalScout Cloud has run at app.signalscout.run since
2026-09-10, at **$20 USD a month after seven free days that ask for no card.**
That figure lives in Stripe and not in this repository — docs/billing.md says
why, and this paragraph is a copy that goes stale the day the price moves.

The hosted product is not charging users for social data or AI usage.

Users continue to bring their own API keys.

We charge for convenience.

## Open Source

**$0**

* Self-hosted
* Full application
* BYO social API keys
* BYO AI provider
* Scheduler
* Docker Compose
* Webhooks
* Full source code

## Hosted

**$20/month**, after seven free days

* No server setup
* Runs 24/7
* Managed scheduler
* Hosted database
* Automatic updates
* Backups
* Email alerts
* Webhooks
* BYO social API keys
* BYO AI key

The positioning should be:

> Don't want to host it yourself? We'll run it for you.

Not:

> Hosted version for people who don't know how to use servers.

Developers may also happily pay simply because they do not want another service to maintain.

---

# Potential future pricing

Keep the entry tier cheap.

```text
Open Source
$0

Hosted
$20/month          the tier that exists
```

This section planned $5-9 for the hosted tier and a Pro tier above it. The
hosted tier shipped at $20 and there is no Pro tier. The reason to keep the
paragraph is the rule under it, which has not changed: keep the entry tier
cheap, and do not design a second tier until people are using the first.

Possible Pro features later:

* More monitors
* Higher polling frequency
* Longer history
* Slack/Discord
* Teams
* API access
* CRM integrations
* Advanced feedback/training
* Shared monitors

Do not worry about this until people are actually using the product.

---

# Positioning

Avoid positioning it as another generic social-listening platform.

Possible positioning:

> **Open-source AI intent monitoring.**

> **Find people talking about the problem your product solves.**

> **Turn Reddit and X conversations into an intent inbox.**

> **Social listening for buyer intent, not vanity metrics.**

> **Your accounts. Your API keys. Your data.**

The differentiation is not having more integrations or more analytics than established social-listening companies.

The differentiation is:

* Open source
* Self-hostable
* BYO APIs
* BYO AI
* Cheap hosted option
* Intent-first
* Built around finding useful conversations rather than producing marketing analytics

---

# What we are NOT building

At least initially:

* A Brandwatch competitor
* Enterprise social-media analytics
* Social publishing
* Social-media scheduling
* Influencer management
* Sentiment analytics
* CRM platform
* Lead enrichment database
* Full sales automation system

Keep the scope narrow:

> Find conversations with intent.

---

# Success criteria

Do not measure the first launch primarily by:

* GitHub stars
* Product Hunt votes
* Website traffic
* Signups

The first meaningful question is:

> Are people receiving matches that they genuinely find valuable?

Early milestones:

1. Get the product working for ourselves.
2. Get 10–20 people self-hosting it.
3. See whether they continue running monitors.
4. Measure whether matches are genuinely useful.
5. Get the first users saying they would rather pay than maintain the server.
6. Launch the hosted version.
7. Get the first 5–10 paying users.
8. Only then expand integrations and features.

---

# Important rule

**Do not add another social network until Reddit + X reliably produce useful matches.**

**This rule has been crossed four times, each one deliberately and each one on
the owner's decision.** LinkedIn in US-028, YouTube in US-034, TikTok in US-044
and Instagram in US-049, all inside 2026-09-05 and 2026-09-06, while the
condition was still unmet: X had run one poll and collected five verdicts. Each
exception is recorded in its own ticket rather than being quietly absorbed here.
The rule stands for the seventh network, and the argument below is unchanged by
having been overruled four times — what those crossings measured is that a
platform's value depends on the product being sold, which is a reason to be
slower rather than faster.

The quality of the intent detection is more important than the number of integrations.

A product with two sources that surfaces five genuinely valuable conversations per day is better than a product with twenty sources generating hundreds of noisy alerts.

---

# Initial product thesis

People already pay for social listening and keyword monitoring.

We are not trying to beat established companies at their own game.

Instead, we are building a smaller open-source tool for people who want:

```text
social conversations
        +
AI understanding
        +
buyer/problem intent
        =
useful opportunities
```

The open-source project creates distribution and trust.

BYOK keeps costs and platform dependency low.

The cheap hosted version monetizes convenience.

And the product succeeds if users regularly look at a match and think:

> “This is exactly the kind of person I wanted to find.”
