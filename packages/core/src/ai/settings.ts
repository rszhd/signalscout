/**
 * One account's own model settings, layered over the instance's. US-068.
 *
 * Correctness-critical: credential encryption. A model key is a key, and the
 * failure shape is the one `secrets/store.ts` names — a key reaching a log line
 * or an API response.
 *
 * **The whole design is one idea: a stored row is an override of the
 * environment.** `readAiEnvironment` takes the instance's `AiEnvironment`,
 * lays this account's rows over it, and hands the result to the same three
 * functions in `config.ts` that have always read it. Those functions carry
 * rules that took measurements to get right — triage falls back to the
 * classifier's settings but not to its price, a key is reused only within one
 * provider, an embedding model is never guessed — and not one of them is
 * rewritten here. A second copy of that logic is how one of them ends up wrong.
 *
 * What follows from that: a person who pastes only an API key keeps the
 * instance's provider and model and simply pays for their own calls, and an
 * account that has stored nothing behaves exactly as it did before this
 * existed. Both are the common case, and neither needed a branch.
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { type AiTask, aiKeys, aiSettings, aiTasks } from "../db/schema.js";
import { decryptSecret, type EncryptionKey, optionalEncryptionKey } from "../secrets/cipher.js";
import type { AiEnvironment, AiProvider, EmbeddingProvider } from "./config.js";
import { readAiKeySecret } from "./keys.js";
import { followsDefault, recommendedModelFor } from "./recommended.js";

/** One task's settings, as a person edits them. The key is never read back. */
export interface AiTaskSettings {
  readonly task: AiTask;
  /** Null keeps the instance's choice. */
  readonly provider: string | null;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly inputPriceMicros: number | null;
  readonly outputPriceMicros: number | null;
  /** Which stored key pays for this job. Null uses the instance's. */
  readonly keyId: string | null;
}

/** What a write carries. Absent means "leave it", which is not the same as null. */
export interface SaveAiTaskInput {
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly baseUrl?: string | null;
  readonly inputPriceMicros?: number | null;
  readonly outputPriceMicros?: number | null;
  /**
   * The stored key this job uses, `null` for the instance's, or `undefined` to
   * leave the choice alone.
   *
   * Three states and not two, because the screen has three. A form that posts
   * every field on every save would otherwise clear the choice each time
   * somebody changed a model — the shape of the bug US-022 found in the monitor
   * `PATCH`, and worth not making twice.
   */
  readonly keyId?: string | null;
}

/** Every task this account has settings for. Never the key itself. */
export async function readAiSettings(db: Database, userId: string): Promise<AiTaskSettings[]> {
  const rows = await db
    .select({
      task: aiSettings.task,
      provider: aiSettings.provider,
      model: aiSettings.model,
      baseUrl: aiSettings.baseUrl,
      inputPriceMicros: aiSettings.inputPriceMicros,
      outputPriceMicros: aiSettings.outputPriceMicros,
      keyId: aiSettings.keyId,
    })
    .from(aiSettings)
    .where(eq(aiSettings.userId, userId));

  return rows;
}

/**
 * Write one task's settings.
 *
 * No secret passes through here since US-079. A job names a key that already
 * exists, and `ai/keys.ts` is the only place one is written.
 */
export async function saveAiTaskSettings(
  db: Database,
  userId: string,
  task: AiTask,
  input: SaveAiTaskInput,
): Promise<void> {
  const columns = {
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
    ...(input.inputPriceMicros === undefined ? {} : { inputPriceMicros: input.inputPriceMicros }),
    ...(input.outputPriceMicros === undefined
      ? {}
      : { outputPriceMicros: input.outputPriceMicros }),
    ...(input.keyId === undefined ? {} : { keyId: input.keyId }),
  };

  await db
    .insert(aiSettings)
    .values({ userId, task, ...columns, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [aiSettings.userId, aiSettings.task],
      set: { ...columns, updatedAt: new Date() },
    });
}

/** Forget one task's settings entirely, key included. */
export async function clearAiTaskSettings(
  db: Database,
  userId: string,
  task: AiTask,
): Promise<void> {
  await db.delete(aiSettings).where(and(eq(aiSettings.userId, userId), eq(aiSettings.task, task)));
}

/** One row, decrypted. Internal: the key never leaves this module upward. */
interface ResolvedTask {
  readonly provider: string | null;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly inputPriceMicros: number | null;
  readonly outputPriceMicros: number | null;
  readonly apiKey: string | undefined;
}

async function resolve(
  db: Database,
  key: EncryptionKey | undefined,
  userId: string,
): Promise<Map<AiTask, ResolvedTask>> {
  // Left join, because a job without a chosen key is the common row and it
  // still carries a provider and a model.
  const rows = await db
    .select({
      task: aiSettings.task,
      provider: aiSettings.provider,
      model: aiSettings.model,
      baseUrl: aiSettings.baseUrl,
      inputPriceMicros: aiSettings.inputPriceMicros,
      outputPriceMicros: aiSettings.outputPriceMicros,
      ciphertext: aiKeys.ciphertext,
      record: aiKeys.record,
    })
    .from(aiSettings)
    .leftJoin(aiKeys, eq(aiKeys.id, aiSettings.keyId))
    .where(eq(aiSettings.userId, userId));

  const found = new Map<AiTask, ResolvedTask>();

  for (const row of rows) {
    // A stored key this process cannot open throws, rather than falling back to
    // the instance's. Quietly classifying on somebody else's key is how a
    // rotation looks like it worked. `secrets/store.ts` makes the same choice.
    const apiKey =
      row.ciphertext && row.record
        ? key
          ? decryptSecret(key, row.ciphertext, row.record)
          : undefined
        : undefined;

    found.set(row.task, {
      provider: row.provider,
      model: row.model,
      baseUrl: row.baseUrl,
      inputPriceMicros: row.inputPriceMicros,
      outputPriceMicros: row.outputPriceMicros,
      apiKey,
    });
  }

  return found;
}

/**
 * The account's default key, opened. US-083.
 *
 * Null is the ordinary answer on a self-hosted instance, and it means every
 * job with no row of its own falls back to the environment, exactly as it did
 * before this existed.
 */
async function readDefault(
  db: Database,
  key: EncryptionKey | undefined,
  userId: string,
): Promise<{ provider: string | null; apiKey: string | undefined } | null> {
  const [row] = await db
    .select({
      provider: aiKeys.provider,
      ciphertext: aiKeys.ciphertext,
      record: aiKeys.record,
    })
    .from(aiKeys)
    .where(and(eq(aiKeys.userId, userId), eq(aiKeys.isDefault, true)));

  if (!row) return null;

  // A stored key this process cannot open throws, for `resolve`'s reason: a
  // rotation that half worked must not read as a key nobody stored.
  return {
    provider: row.provider,
    apiKey: key ? decryptSecret(key, row.ciphertext, row.record) : undefined,
  };
}

/**
 * Every job that said nothing runs on the default key. US-083.
 *
 * **Following the default is the absent row**, which is the same idea this
 * whole file is built on. A person who edits a job has a row, and the row is
 * what "I chose this myself" means — so the default fills the jobs nobody has
 * touched and never overwrites the ones somebody has. Nothing is written when
 * the default changes, so there is nothing to go stale and no restart.
 *
 * The model comes from `recommended.ts` rather than from the instance:
 * `AI_MODEL` is one name on one provider, and a job moved to the default key's
 * provider would otherwise carry a name that provider has never heard of. A
 * provider we recommend nothing for leaves the model unset, which is a job the
 * screen can report as needing one rather than a call that fails at 02:00.
 */
function fill(
  mine: Map<AiTask, ResolvedTask>,
  fallback: { provider: string | null; apiKey: string | undefined },
): void {
  const blank = {
    baseUrl: null,
    inputPriceMicros: null,
    outputPriceMicros: null,
    apiKey: fallback.apiKey,
  };

  for (const task of aiTasks) {
    if (mine.has(task)) continue;

    /**
     * **A job this build cannot complete is left alone entirely.**
     *
     * Moving a job's provider without its model is the one combination that
     * must never be written: `AI_MODEL` is a name the instance's provider
     * answers to, so the pair would fail every call at whatever hour the
     * schedule picked. The save route refuses a person who asks for it, and
     * this is the same refusal where nobody asked. The job stays on the
     * instance, and the screen says it needs a model.
     *
     * `followsDefault` is that question, and the Models screen asks the same
     * function. A screen answering it separately would promise a call this
     * never makes.
     */
    if (!followsDefault(fallback.provider, task)) continue;

    // A key that names no provider moves the bill and nothing else, keeping
    // the deployment's own provider and model — US-068's original case, and
    // the only honest reading of a key whose owner did not say where it goes.
    mine.set(task, {
      provider: fallback.provider,
      model: fallback.provider ? recommendedModelFor(fallback.provider, task) : null,
      ...blank,
    });
  }
}

/**
 * One account's rows over the instance's, before any key is shared.
 *
 * The result is an ordinary `AiEnvironment`, so every caller downstream is the
 * code that already existed. An account with no rows gets the instance's
 * environment back unchanged — not a copy that behaves almost the same, the
 * same object's values.
 */
function overlay(mine: Map<AiTask, ResolvedTask>, instance: AiEnvironment): AiEnvironment {
  const classify = mine.get("classify");
  const triage = mine.get("triage");
  const embed = mine.get("embed");
  const draft = mine.get("draft");

  /**
   * **A moved provider leaves the instance's key behind.**
   *
   * The account's row can change which provider a job runs on while the
   * instance's key for that job stays in the environment underneath. Without
   * this, an account that names OpenAI and stores no key sends the machine's
   * Anthropic key to OpenAI — every call fails, and the sentence a person
   * reads blames a key they never chose.
   *
   * It is `config.ts`'s own rule — a key is reused only within one provider —
   * applied at the seam where the provider moves. The base URL travels with
   * the key for the same reason: it points at the provider the key belongs to.
   */
  const moved = (own: ResolvedTask | undefined, was: string | undefined): boolean =>
    Boolean(own?.provider) && own?.provider !== was && !own?.apiKey;

  const instanceTriage = instance.AI_TRIAGE_PROVIDER ?? instance.AI_PROVIDER;
  const instanceDraft = instance.AI_DRAFT_PROVIDER ?? instance.AI_PROVIDER;
  const instanceEmbed = instance.AI_EMBEDDING_PROVIDER ?? instance.AI_PROVIDER;

  return {
    ...instance,

    ...(moved(classify, instance.AI_PROVIDER)
      ? { AI_API_KEY: undefined, AI_BASE_URL: undefined }
      : {}),
    ...(moved(triage, instanceTriage)
      ? { AI_TRIAGE_API_KEY: undefined, AI_TRIAGE_BASE_URL: undefined }
      : {}),
    ...(moved(draft, instanceDraft)
      ? { AI_DRAFT_API_KEY: undefined, AI_DRAFT_BASE_URL: undefined }
      : {}),
    ...(moved(embed, instanceEmbed)
      ? { AI_EMBEDDING_API_KEY: undefined, AI_EMBEDDING_BASE_URL: undefined }
      : {}),

    ...(classify?.provider ? { AI_PROVIDER: classify.provider as AiProvider } : {}),
    ...(classify?.model ? { AI_MODEL: classify.model } : {}),
    ...(classify?.apiKey ? { AI_API_KEY: classify.apiKey } : {}),
    ...(classify?.baseUrl ? { AI_BASE_URL: classify.baseUrl } : {}),
    ...(classify?.inputPriceMicros === null
      ? {}
      : { AI_INPUT_PRICE_MICROS: classify?.inputPriceMicros }),
    ...(classify?.outputPriceMicros === null
      ? {}
      : { AI_OUTPUT_PRICE_MICROS: classify?.outputPriceMicros }),

    ...(triage?.provider ? { AI_TRIAGE_PROVIDER: triage.provider as AiProvider } : {}),
    ...(triage?.model ? { AI_TRIAGE_MODEL: triage.model } : {}),
    ...(triage?.apiKey ? { AI_TRIAGE_API_KEY: triage.apiKey } : {}),
    ...(triage?.baseUrl ? { AI_TRIAGE_BASE_URL: triage.baseUrl } : {}),
    ...(triage?.inputPriceMicros === null
      ? {}
      : { AI_TRIAGE_INPUT_PRICE_MICROS: triage?.inputPriceMicros }),
    ...(triage?.outputPriceMicros === null
      ? {}
      : { AI_TRIAGE_OUTPUT_PRICE_MICROS: triage?.outputPriceMicros }),

    ...(draft?.provider ? { AI_DRAFT_PROVIDER: draft.provider as AiProvider } : {}),
    ...(draft?.model ? { AI_DRAFT_MODEL: draft.model } : {}),
    ...(draft?.apiKey ? { AI_DRAFT_API_KEY: draft.apiKey } : {}),
    ...(draft?.baseUrl ? { AI_DRAFT_BASE_URL: draft.baseUrl } : {}),
    ...(draft?.inputPriceMicros === null
      ? {}
      : { AI_DRAFT_INPUT_PRICE_MICROS: draft?.inputPriceMicros }),
    ...(draft?.outputPriceMicros === null
      ? {}
      : { AI_DRAFT_OUTPUT_PRICE_MICROS: draft?.outputPriceMicros }),

    ...(embed?.provider ? { AI_EMBEDDING_PROVIDER: embed.provider as EmbeddingProvider } : {}),
    ...(embed?.model ? { AI_EMBEDDING_MODEL: embed.model } : {}),
    ...(embed?.apiKey ? { AI_EMBEDDING_API_KEY: embed.apiKey } : {}),
    ...(embed?.baseUrl ? { AI_EMBEDDING_BASE_URL: embed.baseUrl } : {}),
    ...(embed?.inputPriceMicros === null
      ? {}
      : { AI_EMBEDDING_PRICE_MICROS: embed?.inputPriceMicros }),
  };
}

/**
 * The instance's model settings with one account's laid over them.
 *
 * Each job carries the key it was pointed at, and nothing here decides that a
 * job may use another job's. US-079 replaced that rule with a list a person
 * picks from: two jobs share a key because somebody chose the same one twice,
 * which is a fact on the screen rather than a rule to learn.
 *
 * `config.ts`'s own fallbacks are untouched, and they still matter — a job
 * that picked no key runs on the instance's, and triage still inherits the
 * classifier's settings when it names none of its own.
 */
export async function readAiEnvironment(
  db: Database,
  userId: string,
  instance: AiEnvironment,
  encryption: Record<string, string | undefined> = process.env,
): Promise<AiEnvironment> {
  const key = optionalEncryptionKey(encryption);
  const mine = await resolve(db, key, userId);
  const fallback = await readDefault(db, key, userId);

  if (fallback) fill(mine, fallback);

  if (mine.size === 0) return instance;

  return overlay(mine, instance);
}

/** What a person has on screen for one job, before they have saved it. */
export interface AiTaskDraft {
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly baseUrl?: string | null;
  /** The key they have picked. Null tests the instance's, as a run would. */
  readonly keyId?: string | null;
}

/**
 * The environment one job *would* run in, if a draft were saved. US-080.
 *
 * A test before a save is the useful order — somebody pastes a key, picks a
 * model, and wants to know before they commit to it. The alternative is asking
 * a person to save something they have reason to doubt.
 *
 * It writes nothing, and it is the same overlay the worker reads rather than a
 * second copy of it: a preview built from its own rules would prove the wrong
 * thing on exactly the settings somebody is unsure about.
 */
export async function previewAiEnvironment(
  db: Database,
  userId: string,
  instance: AiEnvironment,
  task: AiTask,
  draft: AiTaskDraft,
  encryption: Record<string, string | undefined> = process.env,
): Promise<AiEnvironment> {
  const key = optionalEncryptionKey(encryption);
  const mine = await resolve(db, key, userId);
  const saved = mine.get(task);

  // The other three jobs are filled the way a run would fill them, so a test
  // of one job is read against the environment the worker would build.
  const fallback = await readDefault(db, key, userId);
  if (fallback) fill(mine, fallback);

  mine.set(task, {
    // Absent means "as saved", the same three states a write has.
    provider: draft.provider === undefined ? (saved?.provider ?? null) : draft.provider,
    model: draft.model === undefined ? (saved?.model ?? null) : draft.model,
    baseUrl: draft.baseUrl === undefined ? (saved?.baseUrl ?? null) : draft.baseUrl,
    inputPriceMicros: saved?.inputPriceMicros ?? null,
    outputPriceMicros: saved?.outputPriceMicros ?? null,
    apiKey:
      draft.keyId === undefined
        ? saved?.apiKey
        : draft.keyId === null
          ? undefined
          : ((await readAiKeySecret(db, key, userId, draft.keyId)) ?? undefined),
  });

  return overlay(mine, instance);
}
