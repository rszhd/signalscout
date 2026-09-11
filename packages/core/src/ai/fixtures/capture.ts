#!/usr/bin/env tsx
/**
 * Ask a real model to score PLAN.md's four worked examples, and record what it
 * said.
 *
 * Two jobs, and they are the same run.
 *
 * **The fixtures.** `examples.test.ts` replays these answers through the real
 * classifier, in CI, for nothing. A recorded answer is the only kind of
 * evidence a test can hold about a model: an answer we wrote would be evidence
 * about our own schema and none at all about the model.
 *
 * **The instrument.** docs/testing.md, *A measured constant needs a committed
 * instrument*: the minimum score that makes a match is a number nothing in the
 * suite can justify. This prints the five scores, the weighted total and the
 * cost for each example, so the number can be chosen from evidence and
 * re-checked when the prompt or the model changes.
 *
 * It spends money — four short calls, well under a cent on a cheap model.
 *
 *     pnpm --filter @signalscout/core capture:classifier
 *     AI_MODEL=gpt-5-mini AI_PROVIDER=openai pnpm --filter @signalscout/core capture:classifier
 *
 * Put the results, the model and the date in the ticket that changed the
 * prompt. A number from a run nobody recorded is a comment, and a comment
 * cannot be re-run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aiEnvSchema } from "../../config/env.js";
import { defaultMinimumScore } from "../../db/schema.js";
import { leadScore } from "../classification.js";
import { createClassifier } from "../classify.js";
import { type AiConfig, aiConfigFromEnvironment } from "../config.js";
import { type CapturedClassification, exampleMonitor, labelledExamples } from "./examples.js";

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
      "AI_PROVIDER picks the client: openai, anthropic, google, deepseek,",
      "openrouter or ollama. AI_MODEL picks the model. A local Ollama needs no key.",
      "",
      "This run makes four calls and costs well under a cent on a cheap model.",
    ].join("\n"),
  );
  process.exit(1);
}

const classifier = createClassifier({ config });

console.log(
  `Scoring ${labelledExamples.length} examples with ${config.provider}/${config.model}\n`,
);

const captured: CapturedClassification[] = [];
let spentMicros = 0;
let unpriced = 0;
let failed = 0;

for (const example of labelledExamples) {
  const outcome = await classifier.classify({ monitor: exampleMonitor, post: example.post });

  if (outcome.status !== "scored") {
    failed += 1;
    console.error(`${example.slug}: ${outcome.status} — ${outcome.error}`);
    continue;
  }

  const record: CapturedClassification = {
    slug: example.slug,
    provider: outcome.call.provider,
    model: outcome.call.model,
    capturedAt: new Date().toISOString(),
    object: outcome.classification as unknown as Record<string, unknown>,
    usage: { inputTokens: outcome.call.inputTokens, outputTokens: outcome.call.outputTokens },
    latencyMs: outcome.call.latencyMs,
    estimatedCostMicros: outcome.call.estimatedCostMicros,
  };

  captured.push(record);

  if (outcome.call.estimatedCostMicros === undefined) unpriced += 1;
  else spentMicros += outcome.call.estimatedCostMicros;
  writeFileSync(`${here}${example.slug}.json`, `${JSON.stringify(record, null, 2)}\n`);

  const { relevance, problemFit, icpFit, intent, urgency, intentType } = outcome.classification;
  const total = leadScore(outcome.classification);
  const keeps = total >= defaultMinimumScore ? "match" : "dropped";

  console.log(
    [
      `${example.label} (PLAN.md intent ${example.plannedIntent})`,
      `  relevance ${relevance}  problemFit ${problemFit}  icpFit ${icpFit}` +
        `  intent ${intent}  urgency ${urgency}  [${intentType}]`,
      `  lead score ${total} -> ${keeps} at the default threshold of ${defaultMinimumScore}`,
      ...outcome.classification.reasons.map((reason) => `  - ${reason}`),
      "",
    ].join("\n"),
  );
}

writeFileSync(
  `${here}manifest.json`,
  `${JSON.stringify(
    {
      capturedBy: "packages/core/src/ai/fixtures/capture.ts",
      provider: config.provider,
      model: config.model,
      note: "The model's own answers to PLAN.md's four worked examples, as the AI SDK parsed them. The monitor is `exampleMonitor` in examples.ts.",
      monitor: exampleMonitor,
      fixtures: captured.map(({ slug, capturedAt, usage, latencyMs, estimatedCostMicros }) => ({
        file: `${slug}.json`,
        capturedAt,
        usage,
        latencyMs,
        estimatedCostMicros,
      })),
    },
    null,
    2,
  )}\n`,
);

// An unpriced call is reported as unpriced, never added in as zero. This run
// spends real money whatever we know about the price, and a total that quietly
// counted an unknown as nothing is the same lie the null column exists to
// avoid.
console.log(
  unpriced > 0
    ? `Wrote ${captured.length} fixtures. ${unpriced} of them cost an unknown amount: ` +
        `no price is configured for ${config.model}. Set AI_INPUT_PRICE_MICROS and ` +
        "AI_OUTPUT_PRICE_MICROS to record what this model costs."
    : `Wrote ${captured.length} fixtures. Spent about ${(spentMicros / 1_000_000).toFixed(6)} US dollars.`,
);

if (failed > 0) process.exit(1);
