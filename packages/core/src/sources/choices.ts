/**
 * Where the choice of provider is written and read.
 *
 * One row per platform per account, and no row is the normal state. A
 * deployment holding one provider's key has one connector that can run, so
 * there is no question and nothing to store. This table is for the deployment
 * that holds both keys, where `registry.only` refuses to answer from
 * registration order.
 *
 * **Every function here takes the owner, and none of them may be given the
 * signed-in person where the monitor's owner is meant.** BUG-010: the table was
 * keyed by the platform alone, so on an instance taking registrations one
 * account's choice decided what every other account polled through — and by
 * US-026's rule a choice that cannot run is refused rather than replaced, so it
 * could stop another account's monitors dead. A poll therefore reads the choice
 * of the monitor's owner, the way `worker/credentials.ts` reads their key.
 *
 * Reading is a whole-table select for one account, and that is deliberate
 * rather than lazy. An account has at most one row per platform — six today —
 * so a poll that needs one entry reads the same page it would read for all of
 * them, and the caller gets an answer that is consistent across the sources one
 * monitor names.
 *
 * Nothing here reaches a collection in flight. `source_continuations` carries
 * the provider that started one, so a changed row takes effect on the next
 * collection and never resumes a Bright Data snapshot through ScrapeCreators.
 * `collect.ts` is where that is enforced, and where the test for it lives.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { type Provider, type Source, sourceProviders } from "../db/schema.js";
import type { ProviderChoices } from "./types.js";

/** Every choice this account has recorded, as a map from platform to provider. */
export async function readProviderChoices(db: Database, userId: string): Promise<ProviderChoices> {
  const rows = await db
    .select({ source: sourceProviders.source, provider: sourceProviders.provider })
    .from(sourceProviders)
    .where(eq(sourceProviders.userId, userId));

  return Object.fromEntries(rows.map((row) => [row.source, row.provider]));
}

/**
 * Record which provider fetches a platform for one account, replacing whatever
 * was there.
 *
 * The caller checks that the provider fetches the platform. It is not checked
 * here because the database cannot know it: the registry holds the pairs, and
 * a check constraint that listed them would need a migration for every
 * connector. `connections.ts` refuses an impossible pair with a sentence that
 * names the ones this build has.
 */
export async function setProviderChoice(
  db: Database,
  userId: string,
  source: Source,
  provider: Provider,
): Promise<void> {
  await db
    .insert(sourceProviders)
    .values({ userId, source, provider })
    .onConflictDoUpdate({
      target: [sourceProviders.userId, sourceProviders.source],
      set: { provider, updatedAt: sql`now()` },
    });
}

/**
 * Forget one account's choice for a platform.
 *
 * The platform then answers by itself again whenever one connector can run,
 * and asks again when two can. Returns false when there was nothing to forget,
 * so a route can tell "cleared" from "there was no choice".
 */
export async function clearProviderChoice(
  db: Database,
  userId: string,
  source: Source,
): Promise<boolean> {
  const removed = await db
    .delete(sourceProviders)
    .where(and(eq(sourceProviders.userId, userId), eq(sourceProviders.source, source)))
    .returning({ source: sourceProviders.source });

  return removed.length > 0;
}
