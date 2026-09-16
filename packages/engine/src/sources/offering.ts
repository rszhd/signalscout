/**
 * Whether a connector this build ships is offered, and what to say when it is
 * not.
 *
 * US-053. A connector can be switched off with one field —
 * `ConnectorDescriptor.notOffered`, the sentence saying why — and this file is
 * the only place that field is read. Everything else asks one of these three
 * functions, so switching off the next connector is that one field and nothing
 * else: no list to edit and no screen to change.
 *
 * Deleting the line from `builtInSources` is the wrong way to do the same
 * thing, and the ticket's Context says why. It hides the platform from the
 * monitor form and leaves three doors open: the API takes its platform list
 * from the `posts.source` enum, so a monitor naming it is still written;
 * `startBlockers` reports nothing for a platform with no connector, so that
 * monitor reads as startable; and the poll then throws at 02:00. Nobody sees a
 * refusal — they see a monitor that collects nothing.
 *
 * So the reason is a value every screen and every write path can read, rather
 * than an absence each of them has to infer.
 */
import type { ConnectorDescriptor, PlatformId, ProviderId } from "./types.js";

/** True unless this connector carries a reason it is not offered. */
export function isOffered(connector: ConnectorDescriptor): boolean {
  return connector.notOffered === undefined;
}

/**
 * The connectors a person may actually use, in the order they were given.
 *
 * For a caller listing connectors itself. Anything that groups by platform
 * gets this filter already, inside `groupByPlatform`.
 */
export function offeredConnectors<T extends ConnectorDescriptor>(
  connectors: readonly T[],
): readonly T[] {
  return connectors.filter(isOffered);
}

/**
 * Why a platform cannot be watched here, or null when it can.
 *
 * Null has two meanings and they are the same answer to the caller: at least
 * one connector for the platform is offered, or this build has no connector
 * for the platform at all. The second is `UnknownSourceError`'s question, not
 * this one's, and answering it here would put two different refusals on one
 * sentence.
 *
 * Where a platform has several switched-off connectors, every distinct reason
 * is joined: two providers were switched off for two reasons, and a person
 * reading one of them would think the other provider was still a way in.
 */
export function notOfferedReason(
  connectors: readonly ConnectorDescriptor[],
  platformId: PlatformId,
): string | null {
  const forPlatform = connectors.filter((connector) => connector.platform.id === platformId);
  if (forPlatform.length === 0) return null;
  if (forPlatform.some(isOffered)) return null;

  const reasons = [...new Set(forPlatform.map((connector) => connector.notOffered as string))];
  return reasons.join(" ");
}

/**
 * Why each switched-off provider of one platform is switched off, keyed by the
 * provider.
 *
 * What `decideProvider` takes as its fourth input. A caller that has the whole
 * connector list asks here rather than filtering itself, so a screen and the
 * poll cannot disagree about which providers are still a real answer.
 */
export function reasonsByProvider(
  connectors: readonly ConnectorDescriptor[],
  platformId: PlatformId,
): Record<ProviderId, string> {
  const reasons: Record<ProviderId, string> = {};

  for (const connector of connectors) {
    if (connector.platform.id !== platformId || connector.notOffered === undefined) continue;
    reasons[connector.provider.id] = connector.notOffered;
  }

  return reasons;
}
