/**
 * The admin view. US-111.
 *
 * One route, and one decision the rest of the API does not make: the account
 * asking must be listed in `ADMIN_EMAILS`. The session gate has already run —
 * this path is behind it like every other API route — so the only question
 * left is whether the person is an admin. A refusal is 403 rather than 401,
 * because they are signed in and still not allowed, and the two send a person
 * to different places.
 *
 * The list is read once at registration rather than per request: it comes from
 * the environment, which does not change while the process runs.
 */
import { adminEmails, type Database, isAdminEmail, registrationsOn } from "@signalscout/core";
import { z } from "zod";
import { sessionUser } from "./auth.js";
import type { ApiServer } from "./server.js";

export const adminBasePath = "/api/admin";

/** The shape every refusal here takes. `projects.ts` and `monitors.ts` too. */
const problemSchema = z.object({ message: z.string() });

const registrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.string(),
  projects: z.number(),
  monitors: z.number(),
  matches: z.number(),
});

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

export async function registerAdminRoutes(
  app: ApiServer,
  { db, adminEmails: configured }: { db: Database; adminEmails?: string | undefined },
): Promise<void> {
  const admins = adminEmails(configured);

  app.route({
    method: "GET",
    url: `${adminBasePath}/registrations`,
    schema: {
      querystring: z.object({ date: z.string().regex(dayPattern).optional() }),
      response: {
        200: z.object({
          date: z.string(),
          users: z.array(registrationSchema),
          totals: z.object({
            users: z.number(),
            projects: z.number(),
            monitors: z.number(),
            matches: z.number(),
          }),
        }),
        403: problemSchema,
      },
    },
    handler: async (request, reply) => {
      const user = sessionUser(request);

      if (!isAdminEmail(user.email, admins)) {
        return reply.code(403).send({ message: "This account is not an administrator." });
      }

      // Today, in UTC, when the request names no day. The database stores
      // instants and a container has no other timezone to mean.
      const day = request.query.date ?? new Date().toISOString().slice(0, 10);
      const report = await registrationsOn(db, day);

      return {
        date: report.date,
        users: report.users.map((one) => ({ ...one, createdAt: one.createdAt.toISOString() })),
        totals: report.totals,
      };
    },
  });
}
