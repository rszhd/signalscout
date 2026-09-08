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
import { type AiTask, aiSettings } from "../db/schema.js";
import {
  decryptSecret,
  type EncryptionKey,
  encryptSecret,
  maskSecret,
  optionalEncryptionKey,
} from "../secrets/cipher.js";
import type { AiEnvironment, AiProvider, EmbeddingProvider } from "./config.js";

/** What the cipher authenticates: the owner, and which task's key it is. */
export function aiRecordName(userId: string, task: AiTask): string {
  return `${userId}:ai:${task}`;
}

/** One task's settings, as a person edits them. The key is never read back. */
export interface AiTaskSettings {
  readonly task: AiTask;
  /** Null keeps the instance's choice. */
  readonly provider: string | null;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly inputPriceMicros: number | null;
  readonly outputPriceMicros: number | null;
  /** `••••1234`, or null when this task uses the instance's key. */
  readonly hint: string | null;
}

/** What a write carries. A blank `apiKey` leaves whatever key is stored. */
export interface SaveAiTaskInput {
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly baseUrl?: string | null;
  readonly inputPriceMicros?: number | null;
  readonly outputPriceMicros?: number | null;
  /**
   * The key to store, `null` to remove the stored one, or `undefined` to leave
   * it alone.
   *
   * Three states and not two, because the screen has three. A form that posts
   * every field on every save would otherwise erase a key each time somebody
   * changed a model — which is the shape of the bug US-022 found in the monitor
   * `PATCH`, and it is worth not making twice.
   */
  readonly apiKey?: string | null;
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
      hint: aiSettings.hint,
    })
    .from(aiSettings)
    .where(eq(aiSettings.userId, userId));

  return rows;
}

/**
 * Write one task's settings.
 *
 * The key is encrypted here or not written at all. There is no path that
 * stores a model key in plain text, the same as for a provider key.
 */
export async function saveAiTaskSettings(
  db: Database,
  key: EncryptionKey | undefined,
  userId: string,
  task: AiTask,
  input: SaveAiTaskInput,
): Promise<void> {
  const record = aiRecordName(userId, task);

  const keyColumns =
    input.apiKey === undefined
      ? {}
      : input.apiKey === null || input.apiKey.trim() === ""
        ? { ciphertext: null, record: null, hint: null }
        : (() => {
            if (!key) {
              throw new Error(
                "This instance cannot store a key yet. Set ENCRYPTION_KEY to the base64 of 32 " +
                  "random bytes — `openssl rand -base64 32` — and restart.",
              );
            }

            const value = input.apiKey.trim();
            return {
              ciphertext: encryptSecret(key, value, record),
              record,
              hint: maskSecret(value),
            };
          })();

  const columns = {
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
    ...(input.inputPriceMicros === undefined ? {} : { inputPriceMicros: input.inputPriceMicros }),
    ...(input.outputPriceMicros === undefined
      ? {}
      : { outputPriceMicros: input.outputPriceMicros }),
    ...keyColumns,
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
  const rows = await db.select().from(aiSettings).where(eq(aiSettings.userId, userId));
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
 * The instance's model settings with one account's laid over them.
 *
 * The result is an ordinary `AiEnvironment`, so every caller downstream is the
 * code that already existed. An account with no rows gets the instance's
 * environment back unchanged — not a copy that behaves almost the same, the
 * same object's values.
 */
export async function readAiEnvironment(
  db: Database,
  userId: string,
  instance: AiEnvironment,
  encryption: Record<string, string | undefined> = process.env,
): Promise<AiEnvironment> {
  const key = optionalEncryptionKey(encryption);
  const mine = await resolve(db, key, userId);

  if (mine.size === 0) return instance;

  const classify = mine.get("classify");
  const triage = mine.get("triage");
  const embed = mine.get("embed");
  const draft = mine.get("draft");

  return {
    ...instance,

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
