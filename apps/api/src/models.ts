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
  type AiConfig,
  type AiTask,
  aiConfigFromEnvironment,
  aiProviders,
  aiTasks,
  clearAiTaskSettings,
  createAiKey,
  type Database,
  DuplicateAiKeyName,
  defaultEmbeddingModels,
  deleteAiKey,
  draftConfigFromEnvironment,
  type EmbeddingConfig,
  type Env,
  embeddingConfigFromEnvironment,
  embeddingNeedsApiKey,
  embeddingProviders,
  followsDefault,
  listAiKeys,
  type ModelProbe,
  needsApiKey,
  optionalEncryptionKey,
  previewAiEnvironment,
  pricedModelsFor,
  probeChatModel,
  probeEmbeddingModel,
  readAiKey,
  readAiSettings,
  recommendedModelFor,
  recordModelCall,
  saveAiTaskSettings,
  setDefaultAiKey,
  triageConfigFromEnvironment,
} from "@signalscout/core";
import { z } from "zod";
import { sessionUserId } from "./auth.js";
import type { ApiServer } from "./server.js";

export interface ModelRoutesOptions {
  readonly db: Database;
  readonly env: Env;
  /** Where `ENCRYPTION_KEY` is read from. A test describes an instance without one. */
  readonly encryption?: Record<string, string | undefined>;
  /**
   * How a key is tested, so a test suite can answer without a provider.
   *
   * Injected rather than imported for the rule in AGENTS.md: no test in this
   * suite spends money, and this is the one route whose whole purpose is to
   * make a billed call.
   */
  readonly probe?: (config: AiConfig) => Promise<ModelProbe>;
  readonly probeEmbedding?: (config: EmbeddingConfig) => Promise<ModelProbe>;
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
  /**
   * The instance's own setting, shown as the value an empty field falls back
   * to — and whether it holds a key for this job at all.
   *
   * `hasKey` is false on a deployment that set none, which is every hosted
   * account: choosing "this instance's key" there means choosing no key, and a
   * picker that offers it without saying so offers a job that cannot run. A
   * local provider needs none, and answers true.
   */
  instance: z.object({
    provider: z.string(),
    model: z.string().nullable(),
    hasKey: z.boolean(),
  }),
  /**
   * What this job runs when its own settings say nothing. US-083.
   *
   * Two answers and the screen says which: the account's default key, or the
   * machine. It is not derived on the screen, because `followsDefault` decides
   * whether a job may follow a key at all — a provider this build can name no
   * model for is left on the instance — and a second copy of that rule on the
   * screen would promise a call the worker never makes.
   */
  fallback: z.object({
    source: z.enum(["key", "instance"]),
    provider: z.string(),
    model: z.string().nullable(),
    hasKey: z.boolean(),
    /** The default key's name, for a card that has to say whose key pays. */
    keyName: z.string().nullable(),
    /** And its id, so a card opened for editing starts on what it already runs. */
    keyId: z.string().nullable(),
  }),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  baseUrl: z.string().nullable(),
  inputPriceMicros: z.number().nullable(),
  outputPriceMicros: z.number().nullable(),
  /** Which stored key pays for this job. Null is the instance's own key. */
  keyId: z.string().nullable(),
});

/** One stored key, as the screen lists it. Never the key itself. */
const keySchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string().nullable(),
  hint: z.string(),
  /** Whether every job with no settings of its own runs on this key. US-083. */
  isDefault: z.boolean(),
});

const modelsSchema = z.object({
  canStore: z.boolean(),
  storeBlocker: z.string().nullable(),
  /**
   * Models this build knows a price for, by provider.
   *
   * By provider rather than one list, because a card offering OpenAI's names
   * to a job running on Anthropic offers a pairing that fails every call. It
   * is the whole catalogue rather than one job's, because the card follows the
   * provider a person is choosing rather than the one that is saved.
   */
  pricedModels: z.record(z.string(), z.array(z.string())),
  /** The embedding model each provider defaults to. See the view for why. */
  embeddingModels: z.record(z.string(), z.string()),
  /** Every key on the account. One list, and every job picks from it. */
  keys: z.array(keySchema),
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
   * Which stored key pays for this job. Null is the instance's own.
   *
   * Absent leaves the choice alone, which is not the same as null: the screen
   * posts every field on every save, and the difference is what stops a model
   * change from quietly moving a job back onto the machine's key.
   */
  keyId: z.string().uuid().nullable().optional(),
});

/** What a test answers: a state, a sentence, and what the call cost. */
const probeSchema = z.object({
  status: z.enum(["ok", "answered", "failed"]),
  provider: z.string(),
  model: z.string(),
  latencyMs: z.number(),
  /** Micro-dollars, or null when this build knows no price for the model. */
  costMicros: z.number().nullable(),
  /** The provider's own sentence, never ours. */
  error: z.string().nullable(),
});

/**
 * What to test, before it is saved.
 *
 * The screen sends what is on it rather than what is stored, because the
 * useful order is test and then keep: somebody pastes a key, picks a model,
 * and wants to know before they commit to it.
 */
const probeBody = z.object({
  keyId: z.string().uuid(),
  model: z.string().trim().min(1).max(200),
  provider: optionalText.nullable().optional(),
  baseUrl: optionalText.nullable().optional(),
});

const keyBody = z.object({
  name: z.string().trim().min(1).max(80),
  /** A label, so the list reads. Null is "not stated" and runs the same. */
  provider: optionalText.nullable().optional(),
  apiKey: z.string().trim().min(1).max(400),
});

export async function registerModelRoutes(
  app: ApiServer,
  {
    db,
    env,
    encryption = process.env,
    probe = probeChatModel,
    probeEmbedding = probeEmbeddingModel,
  }: ModelRoutesOptions,
): Promise<void> {
  /**
   * Whether the machine itself could run this job.
   *
   * Asked of `config.ts` rather than of `env`, because "the instance's key"
   * for triage is the classifier's when triage names none — the fallbacks are
   * measured and a second copy of them here would answer a different question
   * from the one the worker answers.
   */
  function instanceHasKey(task: AiTask): boolean {
    if (task === "embed") {
      const config = embeddingConfigFromEnvironment(env);

      if (!config) return false;
      return !embeddingNeedsApiKey(config.provider) || Boolean(config.apiKey);
    }

    const config =
      task === "triage"
        ? triageConfigFromEnvironment(env)
        : task === "draft"
          ? draftConfigFromEnvironment(env)
          : aiConfigFromEnvironment(env);

    // A local runtime needs no key, so "no key" is not "cannot run" there.
    return !needsApiKey(config.provider) || Boolean(config.apiKey);
  }

  function instanceFor(task: AiTask): {
    provider: string;
    model: string | null;
    hasKey: boolean;
  } {
    const hasKey = instanceHasKey(task);

    if (task === "triage") {
      return {
        provider: env.AI_TRIAGE_PROVIDER ?? env.AI_PROVIDER,
        model: env.AI_TRIAGE_MODEL ?? env.AI_MODEL,
        hasKey,
      };
    }

    if (task === "draft") {
      return {
        provider: env.AI_DRAFT_PROVIDER ?? env.AI_PROVIDER,
        model: env.AI_DRAFT_MODEL ?? env.AI_MODEL,
        hasKey,
      };
    }

    if (task === "embed") {
      return {
        provider: env.AI_EMBEDDING_PROVIDER ?? env.AI_PROVIDER,
        model: env.AI_EMBEDDING_MODEL ?? null,
        hasKey,
      };
    }

    return { provider: env.AI_PROVIDER, model: env.AI_MODEL, hasKey };
  }

  /**
   * What a job with no settings of its own runs on. US-083.
   *
   * The default key answers it when there is one and when this build can name
   * a model for the pair. Otherwise the machine does, which is every
   * self-hosted instance and every account that has marked no default.
   */
  function fallbackFor(
    task: AiTask,
    fallbackKey: { id: string; name: string; provider: string | null } | undefined,
  ): {
    source: "key" | "instance";
    provider: string;
    model: string | null;
    hasKey: boolean;
    keyName: string | null;
    keyId: string | null;
  } {
    const machine = instanceFor(task);

    if (!fallbackKey || !followsDefault(fallbackKey.provider, task)) {
      return { source: "instance", ...machine, keyName: null, keyId: null };
    }

    // A key that names no provider pays for the deployment's own choices.
    const provider = fallbackKey.provider ?? machine.provider;

    return {
      source: "key",
      provider,
      model: fallbackKey.provider ? recommendedModelFor(provider, task) : machine.model,
      hasKey: true,
      keyName: fallbackKey.name,
      keyId: fallbackKey.id,
    };
  }

  async function view(userId: string) {
    const settings = await readAiSettings(db, userId);
    const stored = new Map(settings.map((row) => [row.task, row]));
    const key = optionalEncryptionKey(encryption);
    const keys = await listAiKeys(db, userId);
    const fallbackKey = keys.find((one) => one.isDefault);

    return {
      canStore: key !== undefined,
      storeBlocker: key === undefined ? noEncryptionKey : null,
      pricedModels: Object.fromEntries(
        [...new Set([...aiProviders, ...embeddingProviders])].map((provider) => [
          provider,
          pricedModelsFor(provider),
        ]),
      ),
      /**
       * The embedding model each provider is asked for when nobody names one.
       *
       * Separate from `pricedModels` because we have read no embedding price —
       * `provider.ts` says an embedding is recorded with a null cost until
       * somebody sets one — so the similarity card would otherwise offer an
       * empty list on a job that needs a name to run at all.
       */
      embeddingModels: defaultEmbeddingModels,
      keys,
      tasks: aiTasks.map((task) => {
        const mine = stored.get(task);

        return {
          task,
          ...taskViews[task],
          providers: [...(task === "embed" ? embeddingProviders : aiProviders)],
          instance: instanceFor(task),
          fallback: fallbackFor(task, fallbackKey),
          provider: mine?.provider ?? null,
          model: mine?.model ?? null,
          baseUrl: mine?.baseUrl ?? null,
          inputPriceMicros: mine?.inputPriceMicros ?? null,
          outputPriceMicros: mine?.outputPriceMicros ?? null,
          keyId: mine?.keyId ?? null,
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
      const userId = sessionUserId(request);
      const { keyId } = request.body;

      // A key another account owns is not a key this one may spend. Checked
      // here rather than left to the foreign key, which would answer 500 and
      // say nothing about whose row it was.
      const chosen = keyId ? await readAiKey(db, userId, keyId) : null;

      if (keyId && !chosen) {
        return reply.code(400).send({ message: "That key is not on this account." });
      }

      /**
       * **A key that names its provider decides the job's.**
       *
       * The two were separate fields, and the owner asked why: somebody who
       * has just said "this is my OpenAI key" was then asked, on the same
       * card, which provider the job runs on. There is one right answer, and
       * asking for it invites the wrong one — an OpenAI key on an Anthropic
       * job fails every call, and the sentence a person then reads blames the
       * key.
       *
       * A key with no stated provider decides nothing, and the job's own field
       * is what it always was.
       */
      const provider = chosen?.provider ?? request.body.provider;

      // Refused here rather than at the first call. A provider this build
      // cannot construct is a model call that fails every time, at whatever
      // hour the schedule picked.
      if (provider) {
        const allowed: readonly string[] =
          request.params.task === "embed" ? embeddingProviders : aiProviders;

        if (!allowed.includes(provider)) {
          return reply.code(400).send({
            message: chosen?.provider
              ? `"${chosen.name}" is a ${provider} key, and this build cannot use ${provider} ` +
                `for that job. Choose one of: ${allowed.join(", ")}.`
              : `${provider} is not a provider this build can use for that. ` +
                `Choose one of: ${allowed.join(", ")}.`,
          });
        }
      }

      /**
       * A provider that is not this instance's needs a model of its own.
       *
       * `AI_MODEL` is a name the instance's provider answers to and no other,
       * so a job moved to another provider without a model would be saved as a
       * setting that fails every call — and it would fail quietly, at whatever
       * hour the schedule picked, reading as a bad key.
       */
      const instanceProvider = instanceFor(request.params.task).provider;
      const saved = (await readAiSettings(db, userId)).find(
        (row) => row.task === request.params.task,
      );

      // Absent means "leave it", so the model that matters is the one the row
      // would hold after this write and not the one the body carries.
      const model = request.body.model === undefined ? (saved?.model ?? null) : request.body.model;

      if (provider && provider !== instanceProvider && !model) {
        return reply.code(400).send({
          message:
            `This instance's model is a ${instanceProvider} name, so a job on ${provider} ` +
            "needs a model of its own. Name one.",
        });
      }

      await saveAiTaskSettings(db, userId, request.params.task, {
        ...request.body,
        // The key's own provider wins, and it is written to the row so every
        // reader — the screen, the worker, `config.ts` — sees one answer.
        ...(chosen?.provider ? { provider: chosen.provider } : {}),
      });

      request.log.info(
        // The task and which key, never a key. `secrets/leak.test.ts` asserts
        // a credential logged by mistake is redacted; this line has none.
        { task: request.params.task, keyId: keyId ?? null },
        "stored model settings",
      );

      return view(userId);
    },
  });

  /**
   * Test one job's key and model, by making one small call. US-080.
   *
   * A provider key is tested before it is stored and a model key is not, for
   * the reason US-068 recorded: no model provider here has a free probe, so
   * testing on save would spend somebody's money on a call they did not ask
   * for. **Pressing a button is asking for it**, which is the whole difference
   * and the reason this is its own route.
   *
   * **It tests what is on the screen, not what is stored.** Somebody pastes a
   * key and picks a model, and the useful order is test and then keep — the
   * alternative asks a person to save something they have reason to doubt.
   * Nothing is written either way; a test is a call and not a save.
   *
   * It refuses before it spends. A key that is not this account's, or a job
   * with no model, is 400 with the missing half named.
   *
   * The call is billed, so it is recorded — `key_test` in the ledger, its own
   * purpose so that "what did my key pay for" can tell a test from work the
   * product did.
   */
  app.route({
    method: "POST",
    url: "/api/models/:task/test",
    schema: {
      params: z.object({ task: z.enum(aiTasks) }),
      body: probeBody,
      response: { 200: probeSchema, 400: problemSchema },
    },
    handler: async (request, reply) => {
      const userId = sessionUserId(request);
      const task = request.params.task;
      const { keyId, model, provider, baseUrl } = request.body;

      const chosen = await readAiKey(db, userId, keyId);

      if (!chosen) {
        return reply.code(400).send({ message: "That key is not on this account." });
      }

      // The key's provider decides the job's, on a test as on a save. A test
      // that used a different rule would pass on a setup that then fails.
      const mineEnv = await previewAiEnvironment(
        db,
        userId,
        env,
        task,
        {
          provider: chosen.provider ?? provider ?? null,
          model,
          baseUrl: baseUrl ?? null,
          keyId,
        },
        encryption,
      );

      const config =
        task === "embed"
          ? embeddingConfigFromEnvironment(mineEnv)
          : task === "triage"
            ? triageConfigFromEnvironment(mineEnv)
            : task === "draft"
              ? draftConfigFromEnvironment(mineEnv)
              : aiConfigFromEnvironment(mineEnv);

      if (!config?.model) {
        return reply.code(400).send({ message: "Name a model for this job, then test it." });
      }

      const answer =
        task === "embed"
          ? await probeEmbedding(config as EmbeddingConfig)
          : await probe(config as AiConfig);

      await recordModelCall(db, {
        purpose: "key_test",
        // `answered` is the model failing the shape rather than the call
        // failing, which is exactly what `rejected` means in this ledger.
        outcome:
          answer.status === "ok" ? "scored" : answer.status === "answered" ? "rejected" : "failed",
        call: answer.call,
        error: answer.error ?? null,
      });

      request.log.info(
        // The outcome and the model. Never the key.
        { task, status: answer.status, provider: config.provider, model: config.model },
        "tested a model key",
      );

      return {
        status: answer.status,
        provider: answer.call.provider,
        model: answer.call.model,
        latencyMs: answer.call.latencyMs,
        costMicros: answer.call.estimatedCostMicros ?? null,
        error: answer.error ?? null,
      };
    },
  });

  /**
   * Add a key to the account. US-079.
   *
   * It belongs to nobody's job until somebody picks it, which is the whole
   * point: a person pastes a key once and then says, on each card, which key
   * pays. Nothing is tested against the provider first — no model provider
   * here publishes a free probe, so validating one would spend the person's
   * money on a call they did not ask for. `docs/secrets.md` says so beside the
   * provider keys, which *are* tested.
   */
  app.route({
    method: "POST",
    url: "/api/models/keys",
    schema: {
      body: keyBody,
      response: { 200: modelsSchema, 400: problemSchema, 409: problemSchema },
    },
    handler: async (request, reply) => {
      const key = optionalEncryptionKey(encryption);

      if (!key) return reply.code(400).send({ message: noEncryptionKey });

      const userId = sessionUserId(request);

      try {
        const stored = await createAiKey(db, key, userId, request.body);

        request.log.info(
          // The name and the mask. Never the key, and never the ciphertext.
          { keyId: stored.id, provider: stored.provider },
          "stored a model key",
        );
      } catch (error) {
        if (error instanceof DuplicateAiKeyName) {
          return reply.code(409).send({ message: error.message });
        }

        throw error;
      }

      return view(userId);
    },
  });

  /**
   * Make one key the account's default. US-083.
   *
   * Every job that has no settings of its own then runs on it, on its
   * provider, on this build's recommended model for the pair — and moves again
   * the next time this is called, because following the default is the absence
   * of a row rather than a copy of one. Nothing is rewritten and no worker is
   * restarted.
   *
   * A job somebody saved is untouched. That is not enforced here: it falls out
   * of `readAiEnvironment` filling only the tasks with no row, which is the
   * whole reason the design is that shape.
   */
  app.route({
    method: "PUT",
    url: "/api/models/keys/:id/default",
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: modelsSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const userId = sessionUserId(request);

      if (!(await setDefaultAiKey(db, userId, request.params.id))) {
        return reply.code(404).send({ message: "That key is not on this account." });
      }

      request.log.info(
        // Which key, never a key.
        { keyId: request.params.id },
        "moved the default model key",
      );

      return view(userId);
    },
  });

  /**
   * Remove one.
   *
   * Every job pointing at it goes back to the instance's key rather than to
   * nothing, by the column's own `set null`. A job left pointing at a deleted
   * row would fail every call with no screen able to say why.
   *
   * **Deleting the default promotes nothing.** No other key takes its place,
   * so every following job goes back to the machine — which on a hosted
   * account is no key at all, and the card says so. A promoted key would move
   * those jobs onto a provider nobody chose.
   */
  app.route({
    method: "DELETE",
    url: "/api/models/keys/:id",
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: modelsSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const userId = sessionUserId(request);

      if (!(await deleteAiKey(db, userId, request.params.id))) {
        return reply.code(404).send({ message: "That key is not on this account." });
      }

      return view(userId);
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
