#!/usr/bin/env tsx
/**
 * Ask a real model to write the search queries for one monitor, and record
 * what it said.
 *
 * The same two jobs as `capture.ts`, for the other model call US-010 added.
 *
 * **The fixture.** `queries.test.ts` drives the generator with a stub, which
 * proves our schema and our error handling and says nothing about the model.
 * A recorded plan is the only evidence a test can hold about the model, and a
 * plan we wrote would be evidence about the schema we wrote it against.
 *
 * **The instrument.** Query quality is where a user's bill is decided, and no
 * assertion can say a query is good. This prints the queries and the
 * subreddits so a person can read them and judge, and so the ticket that
 * changes the prompt can carry the before and after.
 *
 * It spends money: one short call.
 *
 *     pnpm --filter @intentwatch/core capture:queries
 *
 * Read the output before trusting it. Two failures are invisible to the
 * schema: a subreddit that does not exist, and eight queries that are one
 * query written eight ways.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aiEnvSchema } from "../../config/env.js";
import { platforms } from "../../sources/platforms.js";
import { type AiConfig, aiConfigFromEnvironment } from "../config.js";
import { createQueryGenerator } from "../queries.js";
import { exampleMonitor } from "./examples.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../", import.meta.url));

/** Read .env without a dependency, the way scripts/dev.mjs does. */
function readEnvFile(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }

  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^["']|["']$/g, "")];
      }),
  );
}

const environment = { ...readEnvFile(`${root}.env`), ...process.env };
const config: AiConfig = aiConfigFromEnvironment(aiEnvSchema.parse(environment));

if (!config.apiKey && config.provider !== "ollama") {
  console.error(
    [
      "No model key. Set AI_API_KEY in .env, or in the environment.",
      "",
      "AI_PROVIDER picks the client: openai, anthropic, google, openrouter or",
      "ollama. AI_MODEL picks the model. A local Ollama needs no key.",
      "",
      "This run makes one call and costs a fraction of a cent on a cheap model.",
    ].join("\n"),
  );
  process.exit(1);
}

const generator = createQueryGenerator({ config });

console.log(`Writing queries for the example monitor with ${config.provider}/${config.model}\n`);

/**
 * Both platforms, in one call.
 *
 * US-027 is the reason this is a list rather than nothing. The plan holds one
 * set of queries per platform, and the fixture is only evidence about the
 * prompt that ships if it was written for the same platforms the product
 * ships. A capture of Reddit alone would go on passing while the X rule rotted.
 */
const outcome = await generator.generate(exampleMonitor, platforms);

if (outcome.status !== "generated") {
  console.error(`${outcome.status} — ${outcome.error}`);
  process.exit(1);
}

const record = {
  provider: outcome.call.provider,
  model: outcome.call.model,
  capturedAt: new Date().toISOString(),
  note: "The model's own answer for `exampleMonitor` in examples.ts, as the AI SDK parsed it.",
  monitor: exampleMonitor,
  object: outcome.plan,
  usage: { inputTokens: outcome.call.inputTokens, outputTokens: outcome.call.outputTokens },
  latencyMs: outcome.call.latencyMs,
  estimatedCostMicros: outcome.call.estimatedCostMicros,
};

writeFileSync(`${here}query-plan.json`, `${JSON.stringify(record, null, 2)}\n`);

console.log("QUERIES");
for (const platform of platforms) {
  const written = outcome.plan.queries[platform.id] ?? [];
  const ceiling = platform.search?.maxQueryWords;

  console.log(`  ${platform.displayName}${ceiling ? ` (at most ${ceiling} words)` : ""}`);

  // The word count is printed beside each query on purpose. The schema already
  // refuses one that is too long, so what a reader needs here is the shape of
  // what came back: eight queries all at the ceiling is a model obeying the
  // letter of the rule, and it reads differently from a spread.
  for (const query of written) {
    console.log(`    ${query}  [${query.split(/\s+/).filter(Boolean).length} words]`);
  }
}
console.log("\nSUBREDDITS");
for (const subreddit of outcome.plan.subreddits) console.log(`  r/${subreddit}`);

// An unpriced call is reported as unpriced, never as zero. The run spent real
// money whatever we know about the price.
console.log(
  outcome.call.estimatedCostMicros === undefined
    ? `\nWrote query-plan.json. The call cost an unknown amount: no price is configured for ${config.model}.`
    : `\nWrote query-plan.json. Spent about ${(outcome.call.estimatedCostMicros / 1_000_000).toFixed(6)} US dollars.`,
);
