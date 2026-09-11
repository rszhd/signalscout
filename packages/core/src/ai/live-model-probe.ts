/**
 * Does this provider answer the call this product actually makes? US-124.
 *
 *     pnpm --filter @signalscout/core live:model-probe
 *     pnpm --filter @signalscout/core live:model-probe --model=deepseek-flash
 *
 * **It spends one call, and on a cheap model that is a fraction of a cent.**
 * The same call the Test button on the Models screen makes: `probeChatModel`,
 * one sentence in, one boolean out, through `generateObject`.
 *
 * **Why it exists.** Every model call this product makes asks for a schema. A
 * provider that answers prose where a schema was asked for scores nothing, and
 * a provider that speaks the OpenAI wire format is not by that fact a provider
 * that speaks structured output — DeepSeek documents `response_format` as
 * `json_object` with no JSON schema, so the AI SDK falls back to putting the
 * schema in the prompt. No test in this repository may find out which happens,
 * because no test may spend money. This is how the next provider gets the same
 * question asked before anybody trusts it with a poll.
 *
 * It reads `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` and `AI_BASE_URL` from
 * `.env`, and `--provider` and `--model` override the first two. The key is
 * always `AI_API_KEY`: it must be a key for whichever provider is probed, and
 * the script prints which one it used so a refusal is never a mystery.
 *
 * Nothing is written. The call is not recorded in the ledger, because there is
 * no account here to bill it to.
 */
import { loadAiEnv } from "../config/env.js";
import type { AiConfig, AiProvider } from "./config.js";
import { aiConfigFromEnvironment, needsApiKey } from "./config.js";
import { probeChatModel } from "./probe.js";

function flag(name: string): string | undefined {
  const found = process.argv.find((argument) => argument.startsWith(`--${name}=`));

  return found?.slice(name.length + 3) || undefined;
}

const env = loadAiEnv(process.env);
const config: AiConfig = {
  ...aiConfigFromEnvironment(env),
  ...(flag("provider") ? { provider: flag("provider") as AiProvider } : {}),
  ...(flag("model") ? { model: flag("model") as string } : {}),
};

if (needsApiKey(config.provider) && !config.apiKey) {
  console.error(
    [
      `No key. ${config.provider} needs AI_API_KEY set in .env or in the environment.`,
      "",
      "Set AI_PROVIDER and AI_MODEL to the pair you want to prove, or pass",
      "--provider= and --model=. The key must belong to the provider probed.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`Probing ${config.provider} / ${config.model}`);
console.log(`Endpoint: ${config.baseUrl ?? "the provider's own"}`);
console.log(`Key: ${config.apiKey ? `••••${config.apiKey.slice(-4)}` : "none, and none needed"}`);
console.log("");

const started = Date.now();
const probe = await probeChatModel(config);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(`Status:  ${probe.status}`);
console.log(`Took:    ${seconds}s`);
console.log(`Tokens:  ${probe.call.inputTokens ?? "?"} in, ${probe.call.outputTokens ?? "?"} out`);
console.log(
  `Cost:    ${
    probe.call.estimatedCostMicros === undefined
      ? "not configured, so not recorded — see docs/costs.md"
      : `$${(probe.call.estimatedCostMicros / 1_000_000).toFixed(6)}`
  }`,
);

if (probe.error) console.log(`Said:    ${probe.error}`);

console.log("");
console.log(
  {
    // The provider took the key, the model answered, and the answer fitted the
    // schema. This is the whole question.
    ok: "This provider answers a structured call. It can score.",
    // The key works and the money was spent. The model is the doubtful half:
    // it answered something the schema refused.
    answered: "The key works and the model answered badly. Try another model.",
    // Nothing usable came back. The sentence above is the provider's own.
    failed: "Nothing usable came back. The key, the model name or the network.",
  }[probe.status],
);
