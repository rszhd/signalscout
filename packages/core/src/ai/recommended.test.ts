/**
 * What a default key fills a job in with. US-083.
 *
 * These cases are about the *table* rather than the mechanism, and each one
 * guards a mistake that would be invisible on the screen: a model name that
 * does not exist, a model sold by a different provider, and a triage model
 * that costs as much as the scorer it is supposed to save money on.
 */
import { describe, expect, it } from "vitest";
import { aiTasks } from "../db/schema.js";
import { defaultEmbeddingModels } from "./config.js";
import { modelPrices } from "./provider.js";
import { recommendationsFor, recommendedModelFor, recommendedProviders } from "./recommended.js";

describe("recommended models", () => {
  it("recommends a chat model this build knows the price of", () => {
    for (const provider of recommendedProviders) {
      for (const task of aiTasks) {
        if (task === "embed") continue;

        const model = recommendedModelFor(provider, task);
        expect(model, `${provider} has no ${task} model`).toBeTruthy();

        // A name we carry no price for would put a job on a model whose calls
        // record no cost, on the deployment that configured nothing.
        const price = modelPrices[model as string];
        expect(price, `${model} is not priced`).toBeDefined();
        expect(price?.provider, `${model} is not sold by ${provider}`).toBe(provider);
      }
    }
  });

  /**
   * US-030's whole finding, as an assertion.
   *
   * Triage reads everything the classifier would, so the stage only pays for
   * itself through the price gap — on one model for both it measured 48% more
   * rather than less. A pair added later with no gap would ship that loss to
   * every account that never opened the screen, and nothing on the screen
   * would look wrong.
   */
  it("triages on a cheaper model than it scores on, for every provider", () => {
    for (const provider of recommendedProviders) {
      const classify = modelPrices[recommendedModelFor(provider, "classify") as string];
      const triage = modelPrices[recommendedModelFor(provider, "triage") as string];

      expect(triage?.input, `${provider} input`).toBeLessThan(classify?.input as number);
      expect(triage?.output, `${provider} output`).toBeLessThan(classify?.output as number);
    }
  });

  it("takes the embedding model from the one table that carries the width rule", () => {
    expect(recommendedModelFor("openai", "embed")).toBe(defaultEmbeddingModels.openai);
  });

  /**
   * Null rather than a guess, in the three places we cannot answer.
   *
   * Anthropic publishes no embedding endpoint; Google's needs a parameter
   * `embed.ts` does not send; Ollama's models are whatever somebody pulled.
   * Each would be a billed call thrown away, or a call that never connects.
   */
  it("says nothing where it has nothing to say", () => {
    expect(recommendedModelFor("anthropic", "embed")).toBeNull();
    expect(recommendedModelFor("google", "embed")).toBeNull();
    expect(recommendedModelFor("ollama", "classify")).toBeNull();
    expect(recommendedModelFor("openrouter", "classify")).toBeNull();
  });

  it("offers every job it can fill for one provider", () => {
    expect(recommendationsFor("openai")).toEqual({
      classify: "gpt-5.6-terra",
      triage: "gpt-5.6-luna",
      draft: "gpt-6-astra",
      embed: "text-embedding-3-small",
    });

    // Three of four, and the missing one is the endpoint Anthropic does not
    // publish rather than a gap in this table.
    expect(recommendationsFor("anthropic").embed).toBeUndefined();
    expect(Object.keys(recommendationsFor("ollama"))).toHaveLength(0);
  });
});
