import {
  type Database,
  deleteAccountWebhookSecret,
  generateAccountWebhookSecret,
  type NotificationEnv,
  notificationDefaults,
  notificationInputSchema,
  notificationReadiness,
  optionalEncryptionKey,
  readNotificationSettings,
  readWebhookSecretHint,
  type SignupMode,
  saveNotificationSettings,
  webhookSecretEnvironment,
} from "@signalscout/core";
import { z } from "zod";
import { ownedMonitor, sessionUserId } from "./auth.js";
import type { ApiServer } from "./server.js";

/** What a person is told when this instance cannot encrypt anything. US-004. */
const noEncryptionKey =
  "This instance has no ENCRYPTION_KEY, so a signing secret cannot be stored. " +
  "Set one and restart, or set WEBHOOK_SIGNING_SECRET for the whole instance.";

export async function registerNotificationRoutes(
  app: ApiServer,
  {
    db,
    env,
    encryption,
    signup = "closed",
  }: {
    db: Database;
    env: NotificationEnv;
    /**
     * Whether a stranger may register here. US-096.
     *
     * Where signup is open the instance's own `WEBHOOK_SIGNING_SECRET` is not
     * an account's to sign with — every account would hold the value every
     * other account's deliveries are signed with. `webhookSecretEnvironment` is
     * the one rule, and this screen has to read it or it would tell an account
     * a webhook is ready that the worker then refuses to sign.
     */
    signup?: SignupMode;
    /**
     * Where `ENCRYPTION_KEY` is read from, kept apart so a test can describe an
     * instance that cannot store a secret. Same seam as the connections screen.
     */
    encryption?: Record<string, string | undefined>;
  },
) {
  const params = z.object({ id: z.uuid() });
  const problem = z.object({ message: z.string() });
  /**
   * The account's signing secret, as a screen may see it. US-096.
   *
   * The hint and never the value: a secret is shown in full once, when it is
   * generated, and a route that returned it afterwards would put it in every
   * response and every log of one.
   */
  const secretView = z.object({
    /** `••••1234`, or null when this account has none of its own. */
    hint: z.string().nullable(),
    /** True when the instance's own `WEBHOOK_SIGNING_SECRET` is what would sign. */
    usingInstanceSecret: z.boolean(),
    /** False when there is no ENCRYPTION_KEY, so one cannot be stored here. */
    canStore: z.boolean(),
    storeBlocker: z.string().nullable(),
    updatedAt: z.string().nullable(),
  });

  const response = z.object({
    settings: notificationInputSchema,
    smtpMissing: z.array(z.string()),
    webhookMissing: z.array(z.string()),
    emailError: z.string().nullable(),
    webhookError: z.string().nullable(),
    nextDigestAt: z.string().nullable(),
    signingSecret: secretView,
  });

  /** The instance's secret, or undefined where it is nobody's to sign with. */
  const instanceSecret = () =>
    webhookSecretEnvironment(signup, { WEBHOOK_SIGNING_SECRET: env.WEBHOOK_SIGNING_SECRET });

  async function secretFor(userId: string) {
    const stored = await readWebhookSecretHint(db, userId);
    const canStore = Boolean(optionalEncryptionKey(encryption ?? process.env));

    return {
      hint: stored?.hint ?? null,
      usingInstanceSecret: !stored && Boolean(instanceSecret()),
      canStore,
      storeBlocker: canStore ? null : noEncryptionKey,
      updatedAt: stored?.updatedAt.toISOString() ?? null,
    };
  }

  async function read(id: string, userId: string) {
    const row = await readNotificationSettings(db, id);
    const signingSecret = await secretFor(userId);

    return {
      settings: notificationInputSchema.parse(row ?? notificationDefaults),
      // The account's own secret answers for the webhook, so an instance whose
      // environment has none is still ready for an account that does. US-096.
      ...notificationReadiness(
        { ...env, WEBHOOK_SIGNING_SECRET: instanceSecret() },
        signingSecret.hint !== null,
      ),
      emailError: row?.emailError ?? null,
      webhookError: row?.webhookError ?? null,
      nextDigestAt: row?.nextDigestAt.toISOString() ?? null,
      signingSecret,
    };
  }
  app.route({
    method: "GET",
    url: "/api/monitors/:id/notifications",
    schema: { params, response: { 200: response, 404: problem } },
    handler: async (request, reply) => {
      if (!(await ownedMonitor(db, request, request.params.id)))
        return reply.code(404).send({ message: "No monitor has that id." });
      return read(request.params.id, sessionUserId(request));
    },
  });
  app.route({
    method: "PUT",
    url: "/api/monitors/:id/notifications",
    schema: {
      params,
      body: notificationInputSchema,
      response: { 200: response, 404: problem, 409: problem },
    },
    handler: async (request, reply) => {
      const userId = sessionUserId(request);
      if (!(await ownedMonitor(db, request, request.params.id)))
        return reply.code(404).send({ message: "No monitor has that id." });

      // The account's own secret counts, so enabling a webhook is refused only
      // when neither it nor the instance can sign. US-096.
      const hasOwnSecret = (await readWebhookSecretHint(db, userId)) !== null;
      const ready = notificationReadiness(
        { ...env, WEBHOOK_SIGNING_SECRET: instanceSecret() },
        hasOwnSecret,
      );
      const missing = [
        ...(request.body.emailEnabled ? ready.smtpMissing : []),
        ...(request.body.webhookEnabled ? ready.webhookMissing : []),
      ];
      if (missing.length)
        return reply.code(409).send({
          message: `Set ${missing.join(", ")} and restart the API and worker before enabling notifications.`,
        });
      await saveNotificationSettings(db, request.params.id, request.body);
      return read(request.params.id, userId);
    },
  });

  /**
   * Make this account a signing secret, and answer with it once. US-096.
   *
   * The **only** response that ever carries the value. It is not stored
   * anywhere a later request can read, and regenerating is the repair for a
   * leak — so this route replaces rather than refusing when one already exists,
   * because a repair that needs a delete first is a repair somebody abandons
   * half way.
   *
   * Every receiver configured with the old value stops verifying the moment
   * this returns. The screen says so before the button is pressed.
   */
  app.route({
    method: "POST",
    url: "/api/notifications/signing-secret",
    schema: {
      response: {
        200: z.object({
          /** Shown once. Nothing reads it back. */
          secret: z.string(),
          signingSecret: secretView,
        }),
        409: problem,
      },
    },
    handler: async (request, reply) => {
      const key = optionalEncryptionKey(encryption ?? process.env);
      if (!key) return reply.code(409).send({ message: noEncryptionKey });

      const userId = sessionUserId(request);
      const secret = await generateAccountWebhookSecret(db, key, userId);

      request.log.info(
        { userId },
        "a webhook signing secret was generated: receivers using the previous value will stop verifying",
      );

      return { secret, signingSecret: await secretFor(userId) };
    },
  });

  /**
   * Give up this account's own secret and sign with the instance's again.
   *
   * On a self-hosted instance that is a real thing to want. Where the
   * environment has no secret either, every webhook then stops being sent —
   * which the screen shows through `webhookMissing` returning.
   */
  app.route({
    method: "DELETE",
    url: "/api/notifications/signing-secret",
    schema: { response: { 200: z.object({ signingSecret: secretView }) } },
    handler: async (request) => {
      const userId = sessionUserId(request);
      await deleteAccountWebhookSecret(db, userId);

      return { signingSecret: await secretFor(userId) };
    },
  });
}
