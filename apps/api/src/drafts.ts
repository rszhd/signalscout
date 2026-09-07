/**
 * Draft a reply to one match, on request.
 *
 * US-040. **Nothing here runs on a schedule.** One button, one match, one
 * call: a draft costs a model call and a person's reputation, and both should
 * be spent on purpose. There is no step, no queue and no cache — pressing the
 * button twice asks the model twice, which is what a person pressing it twice
 * means.
 *
 * **This product never posts.** The route returns a string. It holds no
 * account credential for any network and has no write scope. PLAN.md puts
 * social publishing on the "what we are NOT building" list, and this feature
 * ends at the clipboard.
 */
import type { AiConfig, Database } from "@intentwatch/core";
import {
  budgetStates,
  createDrafter,
  createReplyPrompt,
  DuplicateReplyPromptName,
  deleteReplyPrompt,
  draftContext,
  listReplyPrompts,
  recordModelCall,
  replyVoicePresets,
  singleUserId,
  updateReplyPrompt,
} from "@intentwatch/core";
import { z } from "zod";
import type { ApiServer } from "./server.js";

export interface DraftRoutesOptions {
  readonly db: Database;
  /** Null when no model is configured, which the route reports rather than hides. */
  readonly ai: AiConfig | null;
}

/**
 * How much of a post the model is given.
 *
 * The classifier reads an excerpt of the same length, so a draft answers the
 * text the score was given rather than a longer or shorter one. A draft
 * written from more than the classifier saw would answer a post the score does
 * not describe.
 */
const excerptLength = 2000;

export async function registerDraftRoutes(
  app: ApiServer,
  { db, ai }: DraftRoutesOptions,
): Promise<void> {
  app.route({
    method: "POST",
    url: "/api/matches/:id/draft",
    schema: {
      params: z.object({ id: z.uuid() }),
      /**
       * The instruction to steer this draft with, in the person's own words.
       *
       * Text rather than the id of a saved prompt, and US-063 made the change:
       * an id cannot express "answer the pricing question first, this one
       * time", which is the common case. The screen fills this box from the
       * library and lets it be edited; a saved instruction and a typed one are
       * the same thing by the time they reach the prompt.
       *
       * Absent or empty means draft the way `ai/reply.ts` says.
       */
      body: z.object({ instruction: z.string().max(4000).nullish() }).optional(),
      response: {
        200: z.object({
          reply: z.string(),
          uncertainties: z.array(z.string()),
          model: z.string(),
          /** Null when this model has no published price. docs/costs.md. */
          estimatedCostMicros: z.number().nullable(),
        }),
        402: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
        422: z.object({ message: z.string() }),
        502: z.object({ message: z.string() }),
        503: z.object({ message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      if (!ai) {
        return reply.code(503).send({
          message:
            "No model is configured, so a reply cannot be drafted. Set AI_API_KEY, " +
            "or AI_PROVIDER=ollama to run a local model.",
        });
      }

      const row = await draftContext(db, request.params.id);

      if (!row) return reply.code(404).send({ message: "No match has that id." });

      /**
       * The budget guard, before the call rather than after it.
       *
       * A draft is a model call on somebody's key, so a monitor at its cap
       * must refuse to make one. It is the same rule the poll follows and the
       * same reason: money spent past a cap, silently, is the failure US-013
       * exists to prevent — and a person pressing a button is owed the refusal
       * immediately rather than at 02:00.
       */
      const state = (await budgetStates(db)).get(row.monitorId);

      if (state?.exhausted) {
        return reply.code(402).send({
          message:
            "This monitor has reached its monthly cap, so it will not spend more " +
            "on a draft. Raise the cap or wait for the month to turn over.",
        });
      }

      const instruction = (request.body?.instruction ?? "").trim();

      const drafter = createDrafter({ config: ai });

      const outcome = await drafter.draft({
        monitor: {
          product: row.product,
          idealCustomer: row.idealCustomer,
          problem: row.problem,
          signals: row.signals,
        },
        post: {
          source: row.source,
          channel: row.channel,
          author: row.author,
          title: row.title,
          excerpt: row.excerpt.slice(0, excerptLength),
          postedAt: row.postedAt,
        },
        ...(instruction ? { voice: { instruction } } : {}),
      });

      // Recorded whatever it returned. A person asking "what was my key spent
      // on" must see a draft that failed as well as one that worked: the
      // provider billed for both.
      await recordModelCall(db, {
        purpose: "draft_reply",
        outcome: outcome.status === "ok" ? "scored" : outcome.status,
        call: outcome.call,
        monitorId: row.monitorId,
        postId: row.postId,
        error: outcome.status === "ok" ? null : outcome.error,
      });

      if (outcome.status === "rejected") {
        // A model that declines to write a sales reply is telling the person
        // something, so its own words reach the screen rather than ours.
        request.log.warn({ err: outcome.error }, "the model did not write a usable draft");
        return reply.code(422).send({
          message: `${drafter.model} did not write a usable draft. ${outcome.error}`,
        });
      }

      if (outcome.status === "failed") {
        request.log.error({ err: outcome.error }, "the model could not be reached for a draft");
        return reply.code(502).send({
          message: `${drafter.model} could not be reached. ${outcome.error}`,
        });
      }

      return {
        reply: outcome.draft.reply,
        uncertainties: outcome.draft.uncertainties,
        model: drafter.model,
        estimatedCostMicros: outcome.call.estimatedCostMicros ?? null,
      };
    },
  });
}

/**
 * The prompts a person has saved, and the writes for them.
 *
 * A small CRUD, registered beside the draft route because they are one
 * feature: a prompt with nothing to steer is a note to self, and a draft
 * button with no way to save a preference is the thing the owner asked to
 * change.
 */
export async function registerReplyPromptRoutes(
  app: ApiServer,
  { db }: { readonly db: Database },
): Promise<void> {
  const promptSchema = z.object({
    id: z.string(),
    name: z.string(),
    instruction: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  });

  const fields = {
    name: z.string().min(1).max(120),
    instruction: z.string().min(1).max(4000),
  };

  function serialise(prompt: {
    id: string;
    name: string;
    instruction: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...prompt,
      createdAt: prompt.createdAt.toISOString(),
      updatedAt: prompt.updatedAt.toISOString(),
    };
  }

  /**
   * Voices somebody can start from. US-065.
   *
   * Static text, served rather than bundled, because the web app talks to the
   * API and imports no core — the one architectural rule in the repository.
   * Nothing here is stored: choosing one fills the form, and saving it makes
   * an ordinary row.
   */
  app.route({
    method: "GET",
    url: "/api/reply-prompts/presets",
    schema: {
      response: {
        200: z.object({
          presets: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              instruction: z.string(),
              why: z.string(),
            }),
          ),
        }),
      },
    },
    handler: async () => ({ presets: [...replyVoicePresets] }),
  });

  app.route({
    method: "GET",
    url: "/api/reply-prompts",
    schema: { response: { 200: z.object({ prompts: z.array(promptSchema) }) } },
    handler: async () => ({
      prompts: (await listReplyPrompts(db, singleUserId)).map(serialise),
    }),
  });

  app.route({
    method: "POST",
    url: "/api/reply-prompts",
    schema: {
      body: z.object(fields),
      response: {
        201: promptSchema,
        409: z.object({ message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      try {
        const created = await createReplyPrompt(db, singleUserId, request.body);
        return reply.code(201).send(serialise(created));
      } catch (error) {
        // Two prompts with one name are a person choosing blind, so the name
        // is refused rather than silently made unique.
        if (error instanceof DuplicateReplyPromptName) {
          return reply.code(409).send({ message: error.message });
        }
        throw error;
      }
    },
  });

  app.route({
    method: "PATCH",
    url: "/api/reply-prompts/:id",
    schema: {
      params: z.object({ id: z.uuid() }),
      // Partial and nothing defaulted: a body carrying one field must not
      // erase the other. US-022 fixed exactly this on monitors.
      body: z.object(fields).partial(),
      response: {
        200: promptSchema,
        404: z.object({ message: z.string() }),
        409: z.object({ message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      try {
        const updated = await updateReplyPrompt(db, singleUserId, request.params.id, request.body);

        if (!updated) return reply.code(404).send({ message: "No saved prompt has that id." });

        return serialise(updated);
      } catch (error) {
        if (error instanceof DuplicateReplyPromptName) {
          return reply.code(409).send({ message: error.message });
        }
        throw error;
      }
    },
  });

  app.route({
    method: "DELETE",
    url: "/api/reply-prompts/:id",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 204: z.null(), 404: z.object({ message: z.string() }) },
    },
    handler: async (request, reply) => {
      const gone = await deleteReplyPrompt(db, singleUserId, request.params.id);

      if (!gone) return reply.code(404).send({ message: "No saved prompt has that id." });

      return reply.code(204).send(null);
    },
  });
}
