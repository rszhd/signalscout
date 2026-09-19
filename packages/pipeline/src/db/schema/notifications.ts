/** How a match reaches a person: settings, deliveries, items and webhook secrets. */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { matches } from "./matches.js";
import { monitors } from "./monitors.js";

export const notificationSettings = pgTable(
  "notification_settings",
  {
    monitorId: uuid("monitor_id")
      .primaryKey()
      .references(() => monitors.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    emailEnabled: boolean("email_enabled").notNull().default(false),
    emailTo: text("email_to").notNull().default(""),
    digestHours: integer("digest_hours").notNull().default(24),
    minScore: integer("min_score").notNull().default(50),
    immediateScore: integer("immediate_score"),
    webhookEnabled: boolean("webhook_enabled").notNull().default(false),
    webhookUrl: text("webhook_url").notNull().default(""),
    webhookMode: text("webhook_mode").$type<"match" | "digest">().notNull().default("digest"),
    webhookFailures: integer("webhook_failures").notNull().default(0),
    webhookError: text("webhook_error"),
    emailError: text("email_error"),
    enabledSince: timestamp("enabled_since", { withTimezone: true }).notNull().defaultNow(),
    nextDigestAt: timestamp("next_digest_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("notification_digest_hours_range", sql`${table.digestHours} BETWEEN 1 AND 168`),
    check("notification_min_score_range", sql`${table.minScore} BETWEEN 0 AND 100`),
    check("notification_immediate_score_range", sql`${table.immediateScore} BETWEEN 0 AND 100`),
    check("notification_webhook_mode_known", sql`${table.webhookMode} IN ('match', 'digest')`),
  ],
);

/** A durable outbox. Content is read at delivery time, never copied here. */

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    channel: text("channel").$type<"email" | "webhook">().notNull(),
    kind: text("kind").$type<"match" | "digest">().notNull(),
    status: text("status")
      .$type<"pending" | "sent" | "failed" | "skipped">()
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    index("notification_deliveries_due_idx")
      .on(table.monitorId, table.nextAttemptAt)
      .where(sql`status = 'pending'`),
  ],
);

export const notificationItems = pgTable(
  "notification_items",
  {
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => notificationDeliveries.id, { onDelete: "cascade" }),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    channel: text("channel").$type<"email" | "webhook">().notNull(),
    kind: text("kind").$type<"match" | "digest">().notNull(),
  },
  (table) => [primaryKey({ columns: [table.matchId, table.channel, table.kind] })],
);

/**
 * The secret an account's webhook deliveries are signed with. US-096.
 *
 * **One row per account, and that is the whole point of the table.**
 * `WEBHOOK_SIGNING_SECRET` was one value for the instance, which is right for
 * one person on one machine and wrong the moment a second account exists: the
 * contract hands the secret to the customer to verify with, so every customer
 * would hold the value every other customer's deliveries are signed with, and
 * any of them could sign a payload another's receiver accepts as genuine. It is
 * BUG-010's shape on a different column.
 *
 * **We generate it, so nothing here is pasted and nothing is probed.** That is
 * the difference from `ai_keys` and `source_credentials`, which hold what
 * somebody typed. It is still encrypted, because a database that leaks would
 * otherwise let anybody forge a delivery to a customer's receiver.
 *
 * An account with no row falls back to the environment, which is what keeps
 * every self-hosted instance working unchanged.
 */
export const webhookSecrets = pgTable(
  "webhook_secrets",
  {
    /** One per account, so the account is the key. No foreign key, for `monitors.user_id`'s reason. */
    userId: text("user_id").primaryKey(),
    ciphertext: text("ciphertext").notNull(),
    /** What the cipher authenticated. Stored, never derived. */
    record: text("record").notNull(),
    /** `••••1234`, so a screen can say a secret exists without decrypting one. */
    hint: text("hint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    // A value that is not in the cipher's format was never encrypted by us.
    check("webhook_secrets_ciphertext_format", sql.raw(`ciphertext LIKE 'v1.%.%.%'`)),
    check("webhook_secrets_hint_masked", sql.raw(`hint LIKE '••••%' AND length(hint) <= 8`)),
  ],
);
