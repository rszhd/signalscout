/** An account's credentials and choices: source keys, provider choices, model keys and per-job settings. */
import {
  type AiTask,
  aiTasks,
  type Provider,
  providers,
  type Source,
  sources,
} from "@signalscout/engine";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { oneOf } from "./vocabulary.js";

/**
 * One credential, encrypted, for the day a key stops living in `.env`.
 *
 * US-004. Today every instance reads its keys from the environment, and an
 * environment variable needs no encryption: it is already outside the database
 * and outside git. This table is for the second instance, and for the hosted
 * version, where a key reaches a database somebody else takes backups of.
 *
 * The row is keyed by *provider*, not by platform. A key belongs to the
 * account it was issued for: one Bright Data key serves Reddit, X and
 * LinkedIn, and a table keyed by platform would hold three copies of it and
 * rotate three copies of it. US-024 re-keyed this table and moved the stored
 * Bright Data key from "reddit" to "brightdata" without anybody retyping it.
 *
 * Four things about the columns.
 *
 * `ciphertext` is the whole encrypted payload, `v1.<nonce>.<value>.<tag>`, as
 * `secrets/cipher.ts` writes it. The nonce is stored with the value because a
 * nonce is not a secret; reusing one is what breaks GCM, so each value carries
 * its own. The check constraint refuses anything that is not in that format,
 * which is what stops a plaintext key being pasted in by hand at 02:00 and
 * read back as though it had been encrypted.
 *
 * `hint` is the masked form — four trailing characters and nothing else — and
 * it exists so that showing a person which key is set never decrypts one. The
 * API reads this column and never `ciphertext`.
 *
 * `record` is the name the ciphertext was sealed with, and it is stored rather
 * than computed because computing it would have locked every existing key out.
 * The cipher authenticates the record name, so a row written as "reddit:apiKey"
 * cannot be opened as "brightdata:apiKey" — the re-key would have refused to
 * boot on the very instance that had a working key. A write always sets it to
 * the current name, so a row normalises itself the first time it is replaced or
 * rotated.
 *
 * There is no `updated_by` and no history. A credential is replaced, not
 * versioned: keeping the old ciphertext keeps the old key working after
 * somebody rotates away from it, which is the opposite of the point.
 */
export const sourceCredentials = pgTable(
  "source_credentials",
  {
    /**
     * Which account on *this instance* the key belongs to. US-067.
     *
     * Not to be confused with `provider` below, which is whose account at the
     * data company it is. One person's Bright Data key; another person's is a
     * different row.
     *
     * It was absent until US-066 made a second account possible, and the three
     * faults it removes are worth naming: everybody polled on one key and one
     * bill, the second person to paste a key silently overwrote the first, and
     * anybody signed in could delete a key and stop every monitor on the
     * instance.
     *
     * Text and no foreign key, for `monitors.user_id`'s reason: a row may be
     * older than the first account.
     */
    userId: text("user_id").notNull(),
    /** Whose account the key is on. Never the platform it is used to fetch. */
    provider: text("provider").$type<Provider>().notNull(),
    /** The provider's own field name: `apiKey`, `apiSecret`. */
    field: text("field").notNull(),
    ciphertext: text("ciphertext").notNull(),
    /** What the cipher authenticated. See the header: it is stored, not derived. */
    record: text("record").notNull(),
    /** `••••1234`. What a person is shown, stored so nothing has to decrypt to show it. */
    hint: text("hint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.provider, table.field] }),
    check("source_credentials_provider_known", oneOf("provider", providers)),
    // A value that is not in the cipher's format was never encrypted by us.
    // The database refuses it rather than handing it to a connector as a key.
    check("source_credentials_ciphertext_format", sql.raw(`ciphertext LIKE 'v1.%.%.%'`)),
    // A hint that is longer than the mask is a hint that is leaking.
    check("source_credentials_hint_masked", sql.raw(`hint LIKE '••••%' AND length(hint) <= 8`)),
  ],
);

/**
 * Which provider fetches a platform, when more than one can.
 *
 * One row per platform per account, and a platform with nothing recorded has
 * no row. That is the common deployment: it holds one provider's key, so there
 * is one connector that can run and no question to ask. US-026 built this
 * table for the deployment that holds both, where answering from registration
 * order would spend money at a provider nobody picked.
 *
 * The choice is global across an account's monitors, not per monitor. A person
 * who wants Reddit through Bright Data wants it for every monitor of theirs. A
 * per-monitor override is one column on `monitors` the day somebody asks.
 *
 * Nothing in flight reads this. A collection belongs to the provider that
 * started it, and `source_continuations` carries that provider, so changing a
 * row here takes effect on the next collection and never on the one already
 * running.
 */
export const sourceProviders = pgTable(
  "source_providers",
  {
    /**
     * Whose choice it is. BUG-010.
     *
     * The table was keyed by the platform alone until US-066 made a second
     * account possible, and the fault that removes is worse than a shared
     * preference. US-026's rule is that a recorded choice which cannot run is
     * *refused* rather than replaced — so one account picking the provider it
     * holds a key for would stop every other account's monitors dead, because
     * their key is for the other provider and their polls are refused rather
     * than falling back.
     *
     * Text and no foreign key, for `monitors.user_id`'s reason: a row may be
     * older than the first account.
     */
    userId: text("user_id").notNull(),
    /** The platform. One row per platform per account. */
    source: text("source").$type<Source>().notNull(),
    /** Who fetches it. */
    provider: text("provider").$type<Provider>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.source] }),
    check("source_providers_source_known", oneOf("source", sources)),
    check("source_providers_provider_known", oneOf("provider", providers)),
  ],
);

/**
 * One account's model API keys. US-079.
 *
 * **A key belongs to the account and to no job.** US-068 stored one on each
 * job's row, and US-078 then wrote a rule for lending one job's key to
 * another. The owner read that rule and called it confusing, which it was: a
 * person who has one key had to know where it was kept and which jobs would
 * quietly reach for it. A key is a thing you own, so it is a row of its own,
 * and a job points at one.
 *
 * The cipher and its rules are `source_credentials`': `record` stored per row,
 * `hint` for showing, and no column anything can read a plaintext from. It is
 * a separate table from that one because that is keyed by `Provider`, the
 * data-company enum, and a model provider is a different list.
 *
 * `provider` is a label rather than a rule. It is what the picker shows beside
 * the mask, and what lets a screen say "this is an Anthropic key on an OpenAI
 * job". It is nullable because a key migrated off a job that named no provider
 * has no stated one, and inventing one would be a guess written as a fact.
 */
export const aiKeys = pgTable(
  "ai_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Which account. Text and no foreign key, for `monitors.user_id`'s reason. */
    userId: text("user_id").notNull(),
    /** What the person calls it, so a list of several is choosable. */
    name: text("name").notNull(),
    /** Which provider it is for, as a label. Null means nobody said. */
    provider: text("provider"),
    ciphertext: text("ciphertext").notNull(),
    /** What the cipher authenticated. Stored, never derived. */
    record: text("record").notNull(),
    /** `••••1234`, so showing which key is set decrypts nothing. */
    hint: text("hint").notNull(),
    /**
     * The key every job runs on until a job says otherwise. US-083.
     *
     * A boolean rather than a `default_key_id` on some settings row, because
     * the question is about this key — "is this the one?" — and the screen
     * answers it in the list where the keys are. It is also what makes the
     * partial unique index below possible, and that index is the whole
     * guarantee: two defaults is not a state this table can hold.
     */
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ai_keys_name_not_blank", sql`length(btrim(${table.name})) > 0`),
    // A value that is not in the cipher's format was never encrypted by us.
    check("ai_keys_ciphertext_format", sql.raw(`ciphertext LIKE 'v1.%.%.%'`)),
    check("ai_keys_hint_masked", sql.raw(`hint LIKE '••••%' AND length(hint) <= 8`)),
    // Two keys called the same thing are a person choosing blind, which is the
    // rule `reply_prompts` already follows and for the same reason.
    uniqueIndex("ai_keys_user_name_unique").on(table.userId, sql`lower(${table.name})`),
    // One default per account, enforced by the database rather than by every
    // writer remembering to clear the old one. Two rows claiming it is a
    // question with two answers, and the screen would show whichever the
    // ordering happened to return.
    uniqueIndex("ai_keys_user_default_unique").on(table.userId).where(sql`${table.isDefault}`),
  ],
);

/**
 * One account's model settings for one task. US-068.
 *
 * A row is an override and every column in it is optional: a person who picks
 * only a key keeps the instance's provider and model and simply pays for their
 * own calls, which is the common cloud case.
 *
 * **The key is a reference and not a secret.** US-079 moved the ciphertext to
 * `ai_keys`, so this row says which key pays for this job and holds none of
 * it. Deleting a key sets this back to null, which is the job going back to
 * the instance's own key — a deletion that stopped a job dead with no way to
 * see why would be worse.
 */
export const aiSettings = pgTable(
  "ai_settings",
  {
    /** Which account. Text and no foreign key, for `monitors.user_id`'s reason. */
    userId: text("user_id").notNull(),
    task: text("task").$type<AiTask>().notNull(),
    /** Null keeps the instance's provider for this task. */
    provider: text("provider"),
    /** Null keeps the instance's model. */
    model: text("model"),
    /** For a self-hosted gateway or a local runtime. */
    baseUrl: text("base_url"),
    /**
     * Micro-dollars per million tokens, for a model we carry no price for.
     *
     * Null means "we cannot say", which is what an unpriced call already
     * records. A guessed price would read as a measurement. `embed` uses the
     * input column alone, because an embedding has no output tokens.
     */
    inputPriceMicros: integer("input_price_micros"),
    outputPriceMicros: integer("output_price_micros"),
    /** Which stored key pays for this job. Null uses the instance's. */
    keyId: uuid("key_id").references(() => aiKeys.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.task] }),
    check("ai_settings_task_known", oneOf("task", aiTasks)),
  ],
);

/** US-016. Settings begin with new matches; edits cancel pending deliveries. */
