/**
 * The triage stage the product runs, called the way the worker calls it.
 *
 * **It imports `createTriager` rather than restating the rule.** An earlier
 * harness kept its own copy of the mapping and its own copy of the confidence
 * floor, and the floor was written the wrong way round: it dropped keeps below
 * the threshold, where the engine keeps drops below it. Same words, opposite
 * behaviour, and the comparison said the shipped rule sent 12 items to the
 * classifier when it sends 52. A rule stated twice is a rule that will differ.
 *
 * The output is `keep` or `drop` — the decision, not the verdict. `no` with
 * low confidence is a keep, and naming the output after the verdict is what
 * made that easy to get wrong.
 */
import { createTriager, triageConfigFromEnvironment } from "@signalscout/engine";
import { environment } from "../environment.mjs";

const config = triageConfigFromEnvironment(environment());
const triager = createTriager({ config });

export default class ShippedTriage {
  id = () => `${config.provider}/${config.model}`;

  callApi = async (_prompt, context) => {
    const { vars } = context;

    try {
      const outcome = await triager.triage({
        monitor: {
          product: vars.product,
          idealCustomer: vars.idealCustomer,
          problem: vars.problem,
          signals: String(vars.signals || "")
            .split(", ")
            .filter(Boolean),
        },
        post: {
          source: vars.source,
          channel: vars.channel || null,
          title: vars.title || null,
          excerpt: vars.text,
        },
      });

      return {
        output: outcome.kept ? "keep" : "drop",
        tokenUsage: {
          prompt: outcome.call.inputTokens,
          completion: outcome.call.outputTokens,
          total: (outcome.call.inputTokens ?? 0) + (outcome.call.outputTokens ?? 0),
        },
        cost: (outcome.call.estimatedCostMicros ?? 0) / 1_000_000,
        metadata: { verdict: outcome.verdict, status: outcome.status, error: outcome.error },
      };
    } catch (error) {
      // The stage's own rule: nothing that fails may read as a drop.
      return { output: "keep", error: String(error?.message ?? error) };
    }
  };
}
