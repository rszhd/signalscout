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
