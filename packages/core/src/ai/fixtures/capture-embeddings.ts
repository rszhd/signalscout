#!/usr/bin/env tsx
/**
 * Ask a real embedding model how near each of PLAN.md's example posts is to
 * the example monitor, and record the numbers.
 *
 * US-008's threshold is a measured constant with no measurement. docs/testing.md
 * is blunt about what that means: a number nobody produced with a committed,
 * re-runnable instrument is a number the next person can only read a comment
 * about. This is the instrument.
 *
 * **What it records.** The similarities, not the vectors. A vector is 1,536
 * floats and replaying six of them would add a quarter of a megabyte to the
 * repository to re-prove arithmetic `pgvector` already does. The similarity is
 * the number the threshold is compared against and the number `filter_drops`
 * stores, so it is the number worth keeping.
 *
 * **What it is evidence of.** That a real embedding model separates posts
 * about the monitor's subject from a post about something else — which is the
 * only claim the second stage makes. It is not evidence about intent: the
 * embedding stage cannot tell "Playwright is awesome" from "our Playwright
 * suite is unmaintainable", and it is not supposed to. The classifier does
 * that, and it costs a hundred times more.
 *
 * It spends money: two short calls, well under a hundredth of a cent.
 *
 *     pnpm --filter @intentwatch/core capture:embeddings
 *
 * Read the output before trusting it. The number to look at is the gap between
 * the lowest on-topic post and the off-topic one. A threshold has to sit
 * inside that gap, and if there is no gap, the stage cannot help this monitor.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aiEnvSchema } from "../../config/env.js";
import { defaultSimilarityThreshold } from "../../db/schema.js";
import { monitorDescriptionText, postEmbeddingText } from "../../filter/description.js";
import { fakePosts } from "../../sources/fake/fixtures.js";
import { type EmbeddingConfig, embeddingConfigFromEnvironment } from "../config.js";
import { createEmbedder } from "../embed.js";
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
const config: EmbeddingConfig | undefined = embeddingConfigFromEnvironment(
  aiEnvSchema.parse(environment),
);

if (!config || (!config.apiKey && config.provider !== "ollama")) {
  console.error(
    [
      "No embedding model. Set AI_EMBEDDING_PROVIDER and AI_EMBEDDING_MODEL in .env.",
      "",
      "AI_EMBEDDING_PROVIDER is openai, google, openrouter or ollama. Anthropic",
      "publishes no embedding endpoint, so a deployment on it has to name",
      "another provider here. On openai the model defaults to",
      "text-embedding-3-small and the key falls back to AI_API_KEY.",
      "",
      "The model must return 1536 numbers per embedding: that is the width the",
      "database stores.",
      "",
      "This run makes two short calls and costs well under a hundredth of a cent.",
    ].join("\n"),
  );
  process.exit(1);
}

/** Cosine similarity, as `pgvector` computes it, here so the script needs no database. */
function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;

  for (const [index, value] of left.entries()) {
    const other = right[index] ?? 0;
    dot += value * other;
    leftLength += value * value;
    rightLength += other * other;
  }

  return dot / (Math.sqrt(leftLength) * Math.sqrt(rightLength));
}

const embedder = createEmbedder({ config });

console.log(`Embedding the example monitor and five posts with ${config.provider}/${config.model}`);
console.log("The fifth post is about sourdough, and is the one that must not survive.\n");

const monitorText = monitorDescriptionText(exampleMonitor);
const monitorOutcome = await embedder.embed([monitorText]);

if (monitorOutcome.status !== "embedded") {
  console.error(`failed — ${monitorOutcome.error}`);
  process.exit(1);
}

const monitorVector = monitorOutcome.embeddings[0];

if (!monitorVector) {
  console.error("failed — the model returned no embedding for the monitor.");
  process.exit(1);
}

const postOutcome = await embedder.embed(
  fakePosts.map((post) => postEmbeddingText({ title: post.title, excerpt: post.text })),
);

if (postOutcome.status !== "embedded") {
  console.error(`failed — ${postOutcome.error}`);
  process.exit(1);
}

const measured = fakePosts.map((post, index) => {
  const vector = postOutcome.embeddings[index];
  if (!vector) throw new Error(`The model returned no embedding for ${post.externalId}.`);

  return {
    externalId: post.externalId,
    title: post.title ?? null,
    similarity: Number(cosineSimilarity(monitorVector, vector).toFixed(6)),
  };
});

const tokens = (monitorOutcome.call.inputTokens ?? 0) + (postOutcome.call.inputTokens ?? 0);
const costMicros =
  monitorOutcome.call.estimatedCostMicros === undefined ||
  postOutcome.call.estimatedCostMicros === undefined
    ? undefined
    : monitorOutcome.call.estimatedCostMicros + postOutcome.call.estimatedCostMicros;

const record = {
  provider: config.provider,
  model: config.model,
  capturedAt: new Date().toISOString(),
  note:
    "Cosine similarity between `exampleMonitor` and each of the fake source's five posts, " +
    "measured by a live embedding model. The vectors are not kept: the similarity is the " +
    "number the threshold is compared against and the number filter_drops stores.",
  dimensions: monitorVector.length,
  monitorText,
  similarities: measured,
  usage: { tokens },
  latencyMs: monitorOutcome.call.latencyMs + postOutcome.call.latencyMs,
  estimatedCostMicros: costMicros,
};

writeFileSync(`${here}similarities.json`, `${JSON.stringify(record, null, 2)}\n`);

const sorted = [...measured].sort((left, right) => right.similarity - left.similarity);

console.log("SIMILARITY TO THE MONITOR");
for (const entry of sorted) {
  const keeps = entry.similarity >= defaultSimilarityThreshold ? "keeps " : "drops ";
  console.log(`  ${entry.similarity.toFixed(4)}  ${keeps}  ${entry.title ?? entry.externalId}`);
}

const offTopic = measured.at(-1)?.similarity ?? 0;
const lowestOnTopic = Math.min(...measured.slice(0, 4).map((entry) => entry.similarity));

console.log(
  `\nThe default threshold is ${defaultSimilarityThreshold}. The four on-topic posts sit at or ` +
    `above ${lowestOnTopic.toFixed(4)} and the sourdough post at ${offTopic.toFixed(4)}, ` +
    `so the gap a threshold has to sit inside is ${(lowestOnTopic - offTopic).toFixed(4)} wide.`,
);

console.log(
  costMicros === undefined
    ? `\nWrote similarities.json. The calls cost an unknown amount: no price is configured for ${config.model}. Set AI_EMBEDDING_PRICE_MICROS.`
    : `\nWrote similarities.json. ${tokens} tokens, about ${(costMicros / 1_000_000).toFixed(6)} US dollars.`,
);
