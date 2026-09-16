/**
 * Who a row belongs to, before and after there is an account. US-017.
 *
 * Its own module, with no dependencies, because both halves of the application
 * need the constant and only one of them should have to load an auth library
 * to get it. The worker imports monitors; monitors import this; nothing here
 * imports Better Auth.
 */

import { type Database, unclaimedUserId } from "@signalscout/pipeline";
import { sql } from "drizzle-orm";
import { users } from "../db/schema.js";

export { type SignupMode, signupModes, unclaimedUserId } from "@signalscout/pipeline";

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
