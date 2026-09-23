# @signalscout/engine

**The stateless half of [SignalScout](https://github.com/rszhd/signalscout).**
Connectors, model calls, the pre-filter's free stage, the cost arithmetic and
the cipher. Input in, result and cost out.

```bash
npm install @signalscout/engine
```

Node 24 or newer. ESM only.

---

## The rule

The engine declares no database, no queue, no auth and no payment dependency.
It reads no environment variable, imports nothing from another SignalScout
package, and does not know that an account exists.

So it cannot bill anybody. **It can only report.** Every call that spends money
returns what it spent beside what it found — `unitsConsumed` from a connector,
a `ModelCall` from a model. Deciding whether that spend was allowed belongs to
the caller, which is [`@signalscout/pipeline`](https://www.npmjs.com/package/@signalscout/pipeline)
in this project.

That line is what makes the package usable on its own. A connector here works
in a script with no Postgres anywhere near it.

---

## What is in it

| | |
|---|---|
| `sources/` | Six platforms through five data providers, behind one interface |
| `ai/` | Describing a product, query writing, triage, classification, reply drafting, embeddings |
| `filter/` | The pre-filter's keyword stage. Free, and crude on purpose |
| `estimate/` | What a search plan would collect and what it would cost |
| `secrets/` | AES-256-GCM for a credential that must survive a backup leaking |
| `vocabulary.ts` | Platforms, providers, signals, intents, and two defaults |

---

## Connectors

One interface, four methods, and two of them optional:

```ts
interface SocialSource {
  validateCredentials(credentials: SourceCredentials): Promise<CredentialCheck>;
  search(request: SearchRequest): Promise<SearchResult>;
  verify?(request: VerificationRequest): Promise<VerificationResult>;
  fetchReplies?(request: ReplyRequest): Promise<ReplyResult>;
}
```

Absent means *this provider cannot*, never *the answer is no*. A monitor that
asks for replies on a platform whose connector has no `fetchReplies` still
polls and still returns posts.

A platform and a provider are two axes, not one. The same Reddit post fetched
through Bright Data and through ScrapeCreators is one post. The registry holds
the pair, and the pair is what carries the price.

```ts
import { builtInSources, createSourceRegistry, createSourceRuntime } from "@signalscout/engine";

const registry = createSourceRegistry({
  definitions: builtInSources,
  runtime: createSourceRuntime(),
});

const reddit = registry.get("reddit", "scrapecreators");

const result = await reddit.search({
  query: { queries: ["flaky end to end tests"], channels: ["devops"] },
  credentials: { apiKey: process.env.SCRAPECREATORS_API_KEY! },
});

result.posts;         // CandidatePost[]
result.unitsConsumed; // what the provider billed, which is not the post count
result.next;          // "done", "ready" with a cursor, or "wait"
```

**Read `next`, never `result.posts.length`.** A source may return fewer posts
than you asked for and still have more. A `wait` carries work the provider has
already started and already billed, so dropping that cursor buys records nobody
reads.

Every side effect a connector has arrives through `SourceRuntime` — `fetch`,
`now`, `sleep`, `logger`. That is what lets a test make the network unreachable
and a back-off take no real time.

Adding a platform or a provider is one folder and one registry entry.
[docs/sources.md](https://github.com/rszhd/signalscout/blob/main/docs/sources.md)
has both lists.

---

## Model calls

One client over the Vercel AI SDK, for Anthropic, OpenAI, Google and any
OpenAI-compatible endpoint. Six jobs:

- **describe** — draft the four answers from a document the person already wrote, such as a landing page;
- **queries** — write a monitor's search strings from the four answers a person gave;
- **triage** — one cheap call, one word back: could this author be a person to reach;
- **classify** — score one post against one monitor;
- **draft** — write a reply for a person to edit. On a button press, never on a schedule;
- **embed** — the vectors the pre-filter measures distance with.

Every call ends in one of three outcomes, and the caller needs all three:

```ts
const outcome = await classifier.classify({ monitor, post });

outcome.status; // "scored"   — the model answered
                // "rejected" — the model answered badly
                // "failed"   — the model was not reached
outcome.call;   // tokens and cost, on all three
```

A failure returns; it does not throw a bare error at you. A post left
unclassified must stay retryable, and a cost already paid must still be
recorded.

---

## Testing

```ts
import { silentLogger, unreachableFetch } from "@signalscout/engine/testing";
```

`unreachableFetch` throws on any call, which is how a connector's test proves
it never reached the network.

---

## Versioning

`@signalscout/engine` and `@signalscout/pipeline` are published together, at
one version, from one tag. The pipeline depends on the engine at that exact
version and the two have never been tested mixed. Upgrade both, or neither.

[CHANGELOG.md](https://github.com/rszhd/signalscout/blob/main/CHANGELOG.md)
says what each version changed for a consumer.

---

## License

[Apache-2.0](https://github.com/rszhd/signalscout/blob/main/LICENSE).
