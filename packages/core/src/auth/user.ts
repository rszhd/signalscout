/**
 * Who a row belongs to, before and after there is an account. US-017.
 *
 * Its own module, with no dependencies, because both halves of the application
 * need the constant and only one of them should have to load an auth library
 * to get it. The worker imports monitors; monitors import this; nothing here
 * imports Better Auth.
 */
import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { users } from "../db/schema.js";

/**
 * The id every row carried before there were accounts.
 *
 * `monitors`, `projects`, `reply_prompts` and `feedback` have been `NOT NULL`
 * on `user_id` since they were written, filled with this constant, because an
 * unowned monitor is not a thing the product has. It stops appearing the
 * moment the first account claims those rows, and it stays here for the
 * instruments in `sources/live-*.ts`, which run before anybody signs in.
 */
export const unclaimedUserId = "self-hosted";

/**
 * The account this instance belongs to, or the unclaimed id when it has none.
 *
 * For the live scripts. They write a monitor from a terminal, with no session
 * and no browser, and a monitor written under the unclaimed id after somebody
 * has signed up is a row that exists and shows on no screen. Asking here costs
 * one query and stops that.
 *
 * It answers the *first* account, because US-017 ships one. A second account
 * makes this ambiguous, and that is the day it takes an argument.
 */
export async function ownerUserId(db: Database): Promise<string> {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .orderBy(sql`${users.createdAt} asc`)
    .limit(1);

  return owner?.id ?? unclaimedUserId;
}

/**
 * Whether a stranger may create an account here. US-066.
 *
 * `closed` is the default and it is the self-hosted shape: the first run makes
 * one account and the server refuses every attempt after it. `open` is the
 * cloud shape, where registration is the point.
 *
 * The default is closed rather than open, and the reason is the upgrade. Every
 * instance running today is self-hosted, and a version bump that silently began
 * accepting registrations is exactly the failure US-017 was written to prevent
 * — arriving as a release note nobody read.
 *
 * `invite` is the obvious third value and is deliberately absent. A self-hoster
 * sharing with one colleague is a different problem from a cloud tier taking
 * registrations, and nobody has asked for the first one yet.
 */
export const signupModes = ["closed", "open"] as const;
export type SignupMode = (typeof signupModes)[number];
