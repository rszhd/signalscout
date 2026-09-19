/**
 * A candidate rule: three narrow questions in one call, combined in code.
 *
 * TypeSafe's own guidance — "System One models work best when each question
 * asks one specific, well-scoped thing. Ask each factor as a separate
 * question, then combine the results with logic in your code." The shipped
 * rule asks one three-way question instead, which is the shape their docs
 * argue against.
 *
 * It is here as a candidate and not in the engine. On the 227-post sample it
 * caught the same six leads as the shipped rule and forwarded fewer items,
 * which is promising and is one sample.
 */
import { createEvaluationModel, triageConfigFromEnvironment } from "@signalscout/engine";
import { experimental_evaluate } from "ai";
import { environment } from "../environment.mjs";
import { decide, questions, stateFor } from "../rules/decomposed.mjs";

const config = triageConfigFromEnvironment(environment());
const model = createEvaluationModel(config);

export default class DecomposedTriage {
  id = () => `${config.model} (decomposed)`;

  callApi = async (_prompt, context) => {
    const { vars } = context;

    try {
      const result = await experimental_evaluate({
        model,
        state: stateFor(
          {
            product: vars.product,
            idealCustomer: vars.idealCustomer,
            problem: vars.problem,
            signals: String(vars.signals || "")
              .split(", ")
              .filter(Boolean),
          },
          {
            source: vars.source,
            channel: vars.channel || null,
            title: vars.title || null,
            excerpt: vars.text,
          },
        ),
        questions,
        maxRetries: 2,
      });

      const answers = {
        author: result.answers.author.choice,
        want: result.answers.want.choice,
        fit: result.answers.fit.choice,
      };
      const confidence = result.providerMetadata?.typesafe?.confidence ?? {};
      const decision = decide(answers, confidence);

      return {
        output: decision.verdict === "no" ? "drop" : "keep",
        tokenUsage: {
          prompt: result.usage.inputTokens,
          completion: result.usage.outputTokens,
          total: result.usage.totalTokens,
        },
        cost: ((result.usage.inputTokens ?? 0) * 0.042) / 1_000_000,
        metadata: {
          ...answers,
          because: decision.because,
          confidence: confidence[decision.decidedBy],
        },
      };
    } catch (error) {
      return { output: "keep", error: String(error?.message ?? error) };
    }
  };
}
