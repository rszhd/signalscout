/**
 * The Models screen's routes: whose key pays for a model call, and which model.
 *
 * Correctness-critical: credential encryption. A model key is a key, and the
 * failure shape is the one `connections.ts` names — a key reaching a log line
 * or an API response. Two rules hold it, and both are that file's:
 *
 * **Nothing here returns a stored key.** The read side is the `hint` column,
 * so showing which key is set decrypts nothing. `credentials.test.ts` asserts
 * that structurally over every route this build registers, these included.
 *
 * **A blank key field leaves the stored key alone.** The screen posts every
 * field on every save, so treating blank as "delete" would erase a key each
 * time somebody changed a model. That is the shape US-022 found in the monitor
 * `PATCH`, and it is worth not making twice. Removing a key is its own button.
 *
 * What this screen is *not* is a second place to configure the instance.
 * `AI_PROVIDER`, `AI_MODEL` and `AI_API_KEY` stay the deployment's defaults,
 * and every field here is an override of them. A self-hoster never opens it.
 */
import {
  type AiTask,
  aiProviders,
  aiTasks,
  clearAiTaskSettings,
  type Database,
  type Env,
  embeddingProviders,
  modelPrices,
  optionalEncryptionKey,
  readAiSettings,
  saveAiTaskSettings,
} from "@intentwatch/core";
import { z } from "zod";
import { sessionUserId } from "./auth.js";
import type { ApiServer } from "./server.js";

export interface ModelRoutesOptions {
  readonly db: Database;
  readonly env: Env;
  /** Where `ENCRYPTION_KEY` is read from. A test describes an instance without one. */
  readonly encryption?: Record<string, string | undefined>;
}

/** The sentence an instance with no encryption key is shown. `connections.ts` too. */
const noEncryptionKey =
  "This instance cannot store a key yet. Set ENCRYPTION_KEY to the base64 of 32 " +
  "random bytes — `openssl rand -base64 32` — and restart. Until then, the model " +
  "key in the environment is used for everybody.";

/**
 * What each task is, in the words a person needs to choose a model for it.
 *
 * The measurements are the point. Somebody picking a triage model who does not
 * know it reads every comment before the classifier does will pick the wrong
 * one, and US-030 measured that the saving is entirely the price gap.
 */
const taskViews: Record<AiTask, { title: string; what: string; note: string }> = {
  classify: {
    title: "Scoring posts",
    what: "Reads a post and scores it against the monitor. The answer you see in the inbox.",
    note: "The most expensive call this product makes, and the one worth a good model.",
  },
  triage: {
    title: "Triage",
    what: "Reads everything first and asks one question: could this author be a person to reach?",
    note:
      "It runs before scoring, so it reads more. The whole saving is the price gap — set it to " +
      "a cheaper model than scoring, or it costs more than it saves.",
  },
  draft: {
    title: "Drafting a reply",
    what: "Writes the reply you are offered when you press Draft reply on a match.",
    note:
      "Nothing is ever posted from here. This is the one model output that carries your name " +
      "into somebody else's conversation, so it is worth a model that writes well rather than " +
      "the one that scores well.",
  },
  embed: {
    title: "Similarity",
    what: "Compares a post with your monitor before either model is paid to read it.",
    note:
      "Optional. Anthropic publishes no embedding endpoint, so on Anthropic this needs a " +
      "provider of its own or it stays off — which costs nothing and drops nothing.",
  },
};

const taskSchema = z.object({
  task: z.enum(aiTasks),
  title: z.string(),
  what: z.string(),
  note: z.string(),
  /** Which providers may be named for this task. Embedding has fewer. */
  providers: z.array(z.string()),
  /** The instance's own setting, shown as the value an empty field falls back to. */
  instance: z.object({ provider: z.string(), model: z.string().nullable() }),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  baseUrl: z.string().nullable(),
  inputPriceMicros: z.number().nullable(),
  outputPriceMicros: z.number().nullable(),
  /** `••••1234`, or null when this task uses the instance's key. */
  keyHint: z.string().nullable(),
});

const modelsSchema = z.object({
  canStore: z.boolean(),
  storeBlocker: z.string().nullable(),
  /** Models this build knows a price for, so a cost is recorded rather than null. */
  pricedModels: z.array(z.string()),
  tasks: z.array(taskSchema),
});

const problemSchema = z.object({ message: z.string() });

/** A field the screen may clear by sending an empty string. */
const optionalText = z
  .string()
  .trim()
  .max(200)
  .transform((value) => (value === "" ? null : value));

const saveBody = z.object({
  provider: optionalText.nullable().optional(),
  model: optionalText.nullable().optional(),
  baseUrl: optionalText.nullable().optional(),
  inputPriceMicros: z.number().int().min(0).nullable().optional(),
  outputPriceMicros: z.number().int().min(0).nullable().optional(),
  /**
   * Blank or absent leaves the stored key alone. See the header: the screen
   * posts every field on every save, and a blank field means "unchanged" here
   * rather than "delete". The DELETE route is how a key is removed.
   */
  apiKey: z.string().max(400).optional(),
});

export async function registerModelRoutes(
  app: ApiServer,
  { db, env, encryption = process.env }: ModelRoutesOptions,
): Promise<void> {
  function instanceFor(task: AiTask): { provider: string; model: string | null } {
    if (task === "triage") {
      return {
        provider: env.AI_TRIAGE_PROVIDER ?? env.AI_PROVIDER,
        model: env.AI_TRIAGE_MODEL ?? env.AI_MODEL,
      };
    }

    if (task === "draft") {
      return {
        provider: env.AI_DRAFT_PROVIDER ?? env.AI_PROVIDER,
        model: env.AI_DRAFT_MODEL ?? env.AI_MODEL,
      };
    }

    if (task === "embed") {
      return {
        provider: env.AI_EMBEDDING_PROVIDER ?? env.AI_PROVIDER,
        model: env.AI_EMBEDDING_MODEL ?? null,
      };
    }

    return { provider: env.AI_PROVIDER, model: env.AI_MODEL };
  }

  async function view(userId: string) {
    const stored = new Map((await readAiSettings(db, userId)).map((row) => [row.task, row]));
    const key = optionalEncryptionKey(encryption);

    return {
      canStore: key !== undefined,
      storeBlocker: key === undefined ? noEncryptionKey : null,
      pricedModels: Object.keys(modelPrices),
      tasks: aiTasks.map((task) => {
        const mine = stored.get(task);

        return {
          task,
          ...taskViews[task],
          providers: [...(task === "embed" ? embeddingProviders : aiProviders)],
          instance: instanceFor(task),
          provider: mine?.provider ?? null,
          model: mine?.model ?? null,
          baseUrl: mine?.baseUrl ?? null,
          inputPriceMicros: mine?.inputPriceMicros ?? null,
          outputPriceMicros: mine?.outputPriceMicros ?? null,
          keyHint: mine?.hint ?? null,
        };
      }),
    };
  }

  app.route({
    method: "GET",
    url: "/api/models",
    schema: { response: { 200: modelsSchema } },
    handler: async (request) => view(sessionUserId(request)),
  });

  app.route({
    method: "PUT",
    url: "/api/models/:task",
    schema: {
      params: z.object({ task: z.enum(aiTasks) }),
      body: saveBody,
      response: { 200: modelsSchema, 400: problemSchema },
    },
    handler: async (request, reply) => {
      const key = optionalEncryptionKey(encryption);
      const wantsToStoreKey = Boolean(request.body.apiKey?.trim());

      if (wantsToStoreKey && !key) {
        return reply.code(400).send({ message: noEncryptionKey });
      }

      const { provider } = request.body;

      // Refused here rather than at the first call. A provider this build
      // cannot construct is a model call that fails every time, at whatever
      // hour the schedule picked.
      if (provider) {
        const allowed: readonly string[] =
          request.params.task === "embed" ? embeddingProviders : aiProviders;

        if (!allowed.includes(provider)) {
          return reply.code(400).send({
            message:
              `${provider} is not a provider this build can use for that. ` +
              `Choose one of: ${allowed.join(", ")}.`,
          });
        }
      }

      await saveAiTaskSettings(db, key, sessionUserId(request), request.params.task, {
        ...request.body,
        // Blank means unchanged. `undefined` is what the store reads as that.
        apiKey: wantsToStoreKey ? request.body.apiKey : undefined,
      });

      request.log.info(
        // The task, never the key. `secrets/leak.test.ts` asserts a credential
        // logged by mistake is redacted; this line has none to redact.
        { task: request.params.task, storedKey: wantsToStoreKey },
        "stored model settings",
      );

      return view(sessionUserId(request));
    },
  });

  app.route({
    method: "DELETE",
    url: "/api/models/:task",
    schema: {
      params: z.object({ task: z.enum(aiTasks) }),
      response: { 200: modelsSchema },
    },
    handler: async (request) => {
      await clearAiTaskSettings(db, sessionUserId(request), request.params.task);
      return view(sessionUserId(request));
    },
  });
}
