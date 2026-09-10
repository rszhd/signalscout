/**
 * The account's setup marker. US-105.
 *
 * One route, and it only ever turns the marker on. The gate reads the answer
 * through `/api/auth-status`, so there is no read route here.
 *
 * **The write is the client's, and that is deliberate.** The setup gate's own
 * condition — any provider ready and the scoring job able to run — is computed
 * in `App.tsx` from `/api/connections` and `/api/models`, and it counts keys in
 * the account and keys in the instance's environment alike. A server-side copy
 * of that rule would be a second answer that can disagree with the first. The
 * gate is not a security boundary: a person can only mark their own account,
 * and doing so only lets that person into a product whose forms already refuse
 * a missing key with a reason.
 *
 * The insert is idempotent, so the client may call it on every load where both
 * keys are present. A failed call is retried on the next load.
 */
import { type Database, markOnboardingComplete } from "@signalscout/core";
import { z } from "zod";
import { sessionUserId } from "./auth.js";
import type { ApiServer } from "./server.js";

export interface OnboardingRoutesOptions {
  readonly db: Database;
}

export async function registerOnboardingRoutes(
  app: ApiServer,
  { db }: OnboardingRoutesOptions,
): Promise<void> {
  app.route({
    method: "PUT",
    url: "/api/onboarding",
    schema: {
      response: {
        200: z.object({ onboarded: z.literal(true) }),
      },
    },
    handler: async (request) => {
      await markOnboardingComplete(db, sessionUserId(request));
      return { onboarded: true as const };
    },
  });
}
