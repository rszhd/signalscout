import type {
  ConnectorDefinition,
  PlatformId,
  ProviderId,
  SocialSource,
  SourceRuntime,
} from "./types.js";
import { connectorIdPattern } from "./types.js";

/** One connector's address: the platform it fetches, and who fetches it. */
export interface ConnectorKey {
  readonly platformId: PlatformId;
  readonly providerId: ProviderId;
}

function keyOf({ platformId, providerId }: ConnectorKey): string {
  return `${platformId}:${providerId}`;
}

/** `reddit via brightdata`, the form both errors below list. */
function describe(key: ConnectorKey): string {
  return `${key.platformId} via ${key.providerId}`;
}

function describeAll(keys: readonly ConnectorKey[]): string {
  return keys.map(describe).join(", ") || "(none)";
}

/**
 * Thrown when something asks for a platform no registered connector fetches.
 *
 * The message lists what is registered, because the reader is looking at a
 * crashed boot and needs to know whether the connector is missing or the id is
 * misspelled: `Unknown source "bluesky". Registered sources: reddit, x.`
 */
export class UnknownSourceError extends Error {
  constructor(
    readonly missing: readonly PlatformId[],
    readonly known: readonly PlatformId[],
  ) {
    const subject = missing.length === 1 ? "source" : "sources";
    super(
      `Unknown ${subject} ${missing.map((id) => `"${id}"`).join(", ")}. ` +
        `Registered sources: ${known.join(", ") || "(none)"}.`,
    );
    this.name = "UnknownSourceError";
  }
}

/**
 * Thrown when the platform is known, the provider may be, and no connector
 * pairs them.
 *
 * Both halves are named. A message that said only "unknown source" would send
 * the reader looking for a missing platform when what they have is a Reddit
 * account with the wrong provider — the mistake this ticket's split makes
 * possible, so the error it produces has to name both axes.
 */
export class UnknownConnectorError extends Error {
  constructor(
    readonly missing: ConnectorKey,
    readonly known: readonly ConnectorKey[],
  ) {
    super(
      `No connector fetches "${missing.platformId}" from "${missing.providerId}". ` +
        `Registered connectors: ${describeAll(known)}.`,
    );
    this.name = "UnknownConnectorError";
  }
}

/**
 * Thrown when a platform has more than one provider and nothing has said which
 * to use.
 *
 * It cannot happen while each platform ships one connector. It is here so that
 * the day a second one is registered the choice is demanded loudly, at the
 * caller, rather than settled by registration order.
 */
export class AmbiguousConnectorError extends Error {
  constructor(
    readonly platformId: PlatformId,
    readonly providers: readonly ProviderId[],
  ) {
    super(
      `"${platformId}" is fetched by ${providers.join(" and ")}. ` +
        "Name the provider: this caller has to be told which one to use.",
    );
    this.name = "AmbiguousConnectorError";
  }
}

export interface SourceRegistry {
  /** The connector for this pair, or `UnknownConnectorError`. Never undefined. */
  get(platformId: PlatformId, providerId: ProviderId): SocialSource;
  has(platformId: PlatformId, providerId: ProviderId): boolean;
  /**
   * The one connector for a platform.
   *
   * `UnknownSourceError` when nothing fetches the platform, and
   * `AmbiguousConnectorError` when two things do. Every caller that has a
   * platform and no provider goes through here, so the day a platform has two
   * providers there is one list of callers to give a choice to.
   */
  only(platformId: PlatformId): SocialSource;
  /** Every connector for a platform, in the order the definitions were given. */
  forPlatform(platformId: PlatformId): readonly SocialSource[];
  /** Every registered platform, in the order the definitions were given. */
  platforms(): readonly PlatformId[];
  /** Every registered pair, in the same order. */
  keys(): readonly ConnectorKey[];
  list(): readonly SocialSource[];
  /**
   * Throw unless every platform has a connector, naming all of the missing
   * ones.
   *
   * The collector calls this once at boot with the platforms its monitors
   * name, so a missing connector stops the process instead of failing one
   * poll, quietly, every hour.
   */
  require(platformIds: Iterable<PlatformId>): void;
}

export interface CreateSourceRegistryOptions {
  readonly definitions: readonly ConnectorDefinition[];
  readonly runtime: SourceRuntime;
}

/**
 * Build the registry. Every check here runs at process start, which is the
 * point: a malformed or duplicated connector must not survive to poll time.
 */
export function createSourceRegistry({
  definitions,
  runtime,
}: CreateSourceRegistryOptions): SourceRegistry {
  const connectors = new Map<string, SocialSource>();
  const keys: ConnectorKey[] = [];

  for (const definition of definitions) {
    const key: ConnectorKey = {
      platformId: definition.platform.id,
      providerId: definition.provider.id,
    };

    for (const [axis, id] of [
      ["Source", key.platformId],
      ["Provider", key.providerId],
    ] as const) {
      if (!connectorIdPattern.test(id)) {
        throw new Error(
          `${axis} id "${id}" is not usable. ` +
            "An id is lower-case letters, digits and hyphens, and starts with a letter.",
        );
      }
    }

    if (connectors.has(keyOf(key))) {
      throw new Error(`Two connectors are registered as "${describe(key)}".`);
    }

    if (!Number.isInteger(definition.pricePerUnitMicros) || definition.pricePerUnitMicros < 0) {
      // A fractional or negative price makes every later budget sum wrong by
      // an amount nobody can reconstruct from the stored totals.
      throw new Error(
        `Source "${key.platformId}" prices one ${definition.billableUnit} at ` +
          `${definition.pricePerUnitMicros} micro-dollars, which is not a whole number of them.`,
      );
    }

    if (!Number.isInteger(definition.maxUnitsPerQueryPoll) || definition.maxUnitsPerQueryPoll < 1) {
      // US-014 multiplies this by the polls in a month. A zero here would
      // report every plan on this source as costing nothing, which is the one
      // wrong answer a cost screen must never give.
      throw new Error(
        `Source "${key.platformId}" says one query costs at most ` +
          `${definition.maxUnitsPerQueryPoll} ${definition.billableUnit}s in a poll. ` +
          "It has to be a whole number, and at least one.",
      );
    }

    connectors.set(keyOf(key), definition.create(runtime));
    keys.push(key);
  }

  const platformIds = [...new Set(keys.map((key) => key.platformId))];

  function forPlatform(platformId: PlatformId): SocialSource[] {
    return keys
      .filter((key) => key.platformId === platformId)
      .map((key) => connectors.get(keyOf(key)) as SocialSource);
  }

  return {
    get(platformId, providerId) {
      const connector = connectors.get(keyOf({ platformId, providerId }));
      if (!connector) throw new UnknownConnectorError({ platformId, providerId }, keys);
      return connector;
    },
    has: (platformId, providerId) => connectors.has(keyOf({ platformId, providerId })),
    only(platformId) {
      const found = forPlatform(platformId);
      if (found.length === 0) throw new UnknownSourceError([platformId], platformIds);
      if (found.length > 1) {
        throw new AmbiguousConnectorError(
          platformId,
          found.map((connector) => connector.provider.id),
        );
      }
      return found[0] as SocialSource;
    },
    forPlatform,
    platforms: () => platformIds,
    keys: () => keys,
    list: () => keys.map((key) => connectors.get(keyOf(key)) as SocialSource),
    require(wanted) {
      const missing = [...new Set(wanted)].filter((id) => forPlatform(id).length === 0);
      if (missing.length > 0) throw new UnknownSourceError(missing, platformIds);
    },
  };
}
