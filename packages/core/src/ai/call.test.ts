/**
 * What reaches the model, for a provider whose client will not carry a schema.
 *
 * Correctness-critical by association: this is the classification schema's
 * failure shape one step earlier. A model that is never told the shape answers
 * something else, the schema refuses it, and the call is billed for nothing.
 *
 * BUG-018 found it on DeepSeek, which refuses the call outright, and it was
 * silently true for OpenRouter and Ollama too.
 */
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateStructured } from "./call.js";
import type { AiConfig, AiProvider } from "./config.js";

const schema = z.object({ ready: z.boolean() });

function configFor(provider: AiProvider): AiConfig {
  return { provider, model: "a-model", apiKey: "a-key", timeoutMs: 5_000 };
}

/** Answers, and keeps what it was asked. */
function recordingModel() {
  const seen: string[] = [];

  const model = new MockLanguageModelV4({
    provider: "test",
    modelId: "test-model",
    doGenerate: async (options: { prompt: unknown }) => {
      seen.push(JSON.stringify(options.prompt));

      return {
        content: [{ type: "text" as const, text: '{"ready":true}' }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });

  return { model, sent: () => seen.join("") };
}

async function ask(provider: AiProvider) {
  const { model, sent } = recordingModel();

  const result = await generateStructured({
    model,
    config: configFor(provider),
    schema,
    schemaName: "ready",
    schemaDescription: "Answer that you are ready.",
    system: "You are answering a connection test.",
    prompt: "Are you ready?",
  });

  return { result, sent: sent() };
}

describe("a provider whose client drops the schema", () => {
  /**
   * Both halves matter and they fail differently. Without the schema the model
   * is asked for JSON of no shape. Without the literal word "json" DeepSeek
   * refuses the request before reading it — the same rule as OpenAI's
   * `json_object` mode.
   */
  it.each(["deepseek", "openrouter", "ollama"] as const)(
    "sends the schema and the word json to %s",
    async (provider) => {
      const { result, sent } = await ask(provider);

      expect(result.status).toBe("ok");
      expect(sent).toContain('\\"ready\\"');
      expect(sent).toContain("json");
      // The caller's own words survive. The schema is added, never substituted.
      expect(sent).toContain("You are answering a connection test.");
    },
  );

  /**
   * And the three whose client sends the schema itself are left alone. A
   * schema repeated in the prompt is input tokens on every call of a product
   * whose whole second stage exists to save them.
   */
  it.each(["openai", "anthropic", "google"] as const)(
    "leaves the prompt alone for %s",
    async (provider) => {
      const { result, sent } = await ask(provider);

      expect(result.status).toBe("ok");
      expect(sent).not.toContain("JSON schema");
      expect(sent).toContain("You are answering a connection test.");
    },
  );
});
