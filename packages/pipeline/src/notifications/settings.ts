import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { notificationSettings } from "../db/schema.js";

export const notificationInputSchema = z
  .object({
    emailEnabled: z.boolean().default(false),
    emailTo: z.union([z.email(), z.literal("")]).default(""),
    digestHours: z.number().int().min(1).max(168).default(24),
    minScore: z.number().int().min(0).max(100).default(50),
    immediateScore: z.number().int().min(0).max(100).nullable().default(null),
    webhookEnabled: z.boolean().default(false),
    webhookUrl: z
      .string()
      .max(2048)
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password && !url.hash;
        } catch {
          return false;
        }
      }, "Use an HTTPS URL without a username, password or fragment.")
      .default(""),
    webhookMode: z.enum(["match", "digest"]).default("digest"),
  })
  .superRefine((value, context) => {
    if (value.emailEnabled && !value.emailTo)
      context.addIssue({
        code: "custom",
        path: ["emailTo"],
        message: "Enter a recipient email address.",
      });
    if (value.webhookEnabled && !value.webhookUrl)
      context.addIssue({ code: "custom", path: ["webhookUrl"], message: "Enter a webhook URL." });
  });
export type NotificationInput = z.infer<typeof notificationInputSchema>;
export const notificationDefaults: NotificationInput = notificationInputSchema.parse({});

/**
 * What a new monitor is set to notify with. US-093.
 *
 * Until this existed, `notification_settings` had no row until somebody opened
 * a screen and saved — so a monitor polled, classified and filled an inbox
 * while the one thing that would tell its owner stayed off. On 2026-09-09 the
 * running instance held zero rows in this table and zero deliveries, against
 * 174 posts and 20 matches. That is a default's fault and not a person's.
 *
 * **Email is on only where the deployment can send.** `canSendEmail` comes
 * from `notificationReadiness`, which is the same list the save route and the
 * screen read, and there is no environment variable of this rule's own. This is
 * `AUTH_EMAIL_VERIFICATION`'s shape: the setting and the transport are one
 * thing, so "notifications on, no way to send" cannot be described. Defaulting
 * it on everywhere would queue deliveries on an instance with no mailer, fail
 * each five times, and put an error on a monitor card whose owner never asked
 * to be notified.
 *
 * **The webhook stays off, and that is not an inconsistency.** A webhook needs
 * a URL only the person has. Email has a recipient that did not exist when
 * US-016 was written: US-017 gave the instance accounts, so a monitor's owner
 * has an address.
 *
 * **70 for the immediate email, where the shipped default is 90.** Measured
 * best scores are 71 on Reddit, 66 on X, 69 on LinkedIn, 82 on TikTok and 90
 * on Instagram, so 90 would have fired twice in this product's history. The
 * 24-hour digest at 50 carries the rest — US-022 measured that 50 leaves nine
 * matches that are all real where 30 lets "Dev memes" through.
 */
export function defaultNotificationSettings(options: {
  readonly canSendEmail: boolean;
  readonly emailTo: string | null;
}): NotificationInput {
  const emailTo = options.emailTo ?? "";
  // An address is as necessary as a mailer. The schema refuses the pair
  // anyway; deciding it here means the refusal is never reached rather than
  // caught.
  const emailEnabled = options.canSendEmail && emailTo !== "";

  return notificationInputSchema.parse({
    emailEnabled,
    emailTo,
    immediateScore: 70,
  });
}

export async function readNotificationSettings(db: Database, monitorId: string) {
  const [row] = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.monitorId, monitorId));
  return row ?? null;
}

export async function saveNotificationSettings(
  db: Database,
  monitorId: string,
  input: NotificationInput,
  now = new Date(),
) {
  const values = {
    ...notificationInputSchema.parse(input),
    enabledSince: now,
    nextDigestAt: new Date(now.getTime() + input.digestHours * 3_600_000),
    webhookFailures: 0,
    webhookError: null,
    emailError: null,
  };
  const [row] = await db
    .insert(notificationSettings)
    .values({ monitorId, ...values })
    .onConflictDoUpdate({
      target: notificationSettings.monitorId,
      set: { ...values, revision: sql`${notificationSettings.revision} + 1` },
    })
    .returning();
  if (!row) throw new Error("Notification settings were not saved.");
  return row;
}

export async function notificationIssues(db: Database) {
  const rows = await db
    .select({
      monitorId: notificationSettings.monitorId,
      email: notificationSettings.emailError,
      webhook: notificationSettings.webhookError,
    })
    .from(notificationSettings);
  return new Map(
    rows.map((row) => [
      row.monitorId,
      [row.email, row.webhook].filter((value): value is string => value !== null),
    ]),
  );
}
