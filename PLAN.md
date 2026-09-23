# Project Plan

The product rules: what SignalScout is for, what it will not become, and how
we will know it works. What it does today is in the [README](README.md) and
on [docs.signalscout.run](https://docs.signalscout.run); why each tool was
chosen is in [STACK.md](STACK.md). Read this before proposing anything
structural.

## What we’re building

A **fair-source AI intent monitoring tool** that watches social platforms and
surfaces conversations from people who may actually need what you sell.

Traditional social listening answers *who mentioned my brand*. This product
answers one question:

> Who is publicly talking about a problem my product can solve?

**Self-hosted first.** The self-hosted build is the whole application, and it
is not cut down to make a hosted version worth paying for. Self-hosted, the
user brings the keys: a data provider's for each platform, and a model's. They
own the accounts and pay for their own usage.

---

## Core idea

A person describes, once per business (a *project*):

* What their product does
* Who their ideal customer is
* What problems they solve

and, per monitor, the buying signals they care about. The system searches the
platforms on a schedule, collects candidate posts, and uses AI to evaluate
each conversation.

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

Instead of alerting on every keyword match, AI filters the noise and surfaces
the conversations that actually matter.

---

## Monitoring flow

This is the shape. [docs/pipeline.md](docs/pipeline.md) is how it runs: the
caps, the cursors, and which row each step leaves behind.

```text
Reddit · X · LinkedIn · YouTube · TikTok · Instagram
                    │   (through data providers)
                    ▼
             Candidate posts
                    │
                    ▼
    Cheap stages: keyword → similarity → triage
                    │
                    ▼
            AI intent engine
          relevance · ICP · intent
                    │
                    ▼
       Lead score, at or above the
        monitor's minimum = a match
                    │
     ┌──────┬───────┼───────┬──────────┐
     ▼      ▼       ▼       ▼          ▼
   Inbox  Email  Webhook   CSV    Reply draft
```

Money is spent at fetch time, before any filter sees a post, so every monitor
has a monthly cap and every search plan can be priced before it runs.

---

## Intent classification

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

These four are the classifier's labelled set: `ai/fixtures/examples.ts`
copies them, and [docs/testing.md](docs/testing.md) says how they are used.
Change one here and change it there.

Classification fields:

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

Intent types:

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

## The intent inbox

The core product is an **intent inbox**, not a social-listening analytics
dashboard.

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

[Open conversation]  [Save for later]
[Draft reply]        [Good lead]  [Not relevant]
```

**The claims are neutral, and the score above them says how it went.** The
classifier is asked for claims about the post, not for support for its own
score, so on a weak post some of what it saw is negative: "the post does not
ask for a tool" is one of the most useful lines on the card. A heading that
only reads correctly on a good match hides exactly the matches a person most
needs to dismiss quickly.

The experience should feel like:

> An inbox of people who might need your product.

Not:

> A social-media analytics dashboard.

---

## Monitor creation

Creating a monitor should be simple. The first three answers belong to the
project and are copied into each monitor made from it:

* **Product** — What do you sell?
* **Ideal customer** — Who is most likely to buy it?
* **Problem** — What problem does it solve?

Then the monitor's own choices:

* **Signals** — what the system should look for:

  ```text
  ☑ Asking for recommendations
  ☑ Looking for alternatives
  ☑ Complaining about their current solution
  ☑ Describing the problem
  ☑ Comparing products
  ☑ Ready to buy
  ☑ Looking to hire someone
  ```

  `packages/engine/src/signals.ts` holds these labels; they are the checkbox
  text and the query generator's vocabulary at once.
* **Sources** — which platforms to watch.
* **Search plan** — the system writes the searches; the person edits them.
  Nobody should need to become a Boolean-search expert.
* **Schedule & budget** — how often, and the most it may spend in a month.

---

## Feedback loop

Every match offers a verdict:

```text
👍 Good lead
👎 Not relevant
```

Different businesses consider different things valuable. **The goal** is for
the system to learn what this particular user considers a good lead.

**Nothing implements that yet.** A verdict is stored, hides a match marked
not relevant, and can be exported; the classifier does not read it. The path
there is measured first: thirty verdicts to say whether the score is right
(US-033), then a harness to compare a rule (US-231).

---

## What we are NOT building

At least initially:

* A Brandwatch competitor
* Enterprise social-media analytics
* Sentiment charts, share of voice, word clouds, competitor reports
* Social publishing or scheduling — a reply draft ends at the clipboard
* Influencer management
* A CRM platform
* A lead enrichment database
* A full sales automation system

Keep the scope narrow:

> Find conversations with intent.

---

## Important rule

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

## Success criteria

Do not measure the product primarily by GitHub stars, Product Hunt votes,
website traffic or signups.

The first meaningful question is:

> Are people receiving matches that they genuinely find valuable?

Early milestones:

1. Get the product working for ourselves.
2. Get 10–20 people self-hosting it.
3. See whether they continue running monitors.
4. Measure whether matches are genuinely useful.
5. Launch the hosted version — **done**: SignalScout Cloud has run at
   app.signalscout.run since 2026-09-10.
6. Get the first 5–10 paying users.
7. Only then expand integrations and features.

The product succeeds if users regularly look at a match and think:

> “This is exactly the kind of person I wanted to find.”

---

## Cloud version

SignalScout Cloud is a separate, private product built on the two packages
this repository publishes (US-151, US-155). It includes the data and model
usage, so a cloud customer brings no keys, and it charges; its plans and
prices live there and on the pricing page, not here. This repository charges
nobody, and nothing in it knows a subscription.
