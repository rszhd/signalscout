import { notOfferedReason, reasonsByProvider } from "./offering.js";
import type {
  ConnectorDefinition,
  PlatformId,
  ProviderChoices,
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
 * Thrown when a platform has more than one usable provider and nothing has
 * said which to use.
 *
 * The choice is demanded loudly, at the caller, rather than settled by
 * registration order: answering with the first would spend somebody's money at
 * a provider they did not pick. `source_providers` is where the answer goes
 * once somebody has made it, and the connections screen is where they make it.
 */
export class AmbiguousConnectorError extends Error {
  constructor(
    readonly platformId: PlatformId,
    readonly providers: readonly ProviderId[],
  ) {
    super(
      `"${platformId}" is fetched by ${providers.join(" and ")}. ` +
        "Record which one to use: nothing has chosen, and registration order is not a choice.",
    );
    this.name = "AmbiguousConnectorError";
  }
}

/**
 * Thrown when no provider can fetch a platform here, and the build has one.
 *
 * Two states land on this, and both are a deployment's rather than a build's.
 * Nothing can run the platform, because this deployment holds no key for any
 * of its providers. Or the recorded choice names a provider that cannot run,
 * because its key was removed or a rotation is half done.
 *
 * The second is not answered by quietly using the other provider. A person who
 * chose ScrapeCreators and lost its key would then have every poll billed to
 * Bright Data, which prices the same subreddit page at twenty times as much.
 * The refusal names the choice and what is left, so both repairs — connect
 * that provider, or choose another — are one action.
 */
export class NoUsableProviderError extends Error {
  constructor(
    readonly platformId: PlatformId,
    /** The recorded choice, or null when nothing was chosen. */
    readonly chosen: ProviderId | null,
    readonly available: readonly ProviderId[],
  ) {
    super(
      chosen
        ? `"${platformId}" is set to fetch through "${chosen}", which cannot run here. ` +
            `Available: ${available.join(", ") || "(none)"}. ` +
            "Connect that provider, or choose one of these instead."
        : `No provider can fetch "${platformId}" here. ` +
            `This build fetches it through ${available.join(", ")}, and none of them can run. ` +
            "Connect one on the connections screen.",
    );
    this.name = "NoUsableProviderError";
  }
}

/**
 * Thrown when this build ships a connector for the platform and offers none of
 * them.
 *
 * Its own error rather than `UnknownSourceError`, because the two send a reader
 * to opposite places. "Unknown" means the id is wrong or a connector is
 * missing, and somebody goes looking for the code. This means the code is
 * there, working and deliberately switched off, and the message carries the
 * sentence that says why. US-053.
 */
export class ConnectorNotOfferedError extends Error {
  constructor(
    readonly platformId: PlatformId,
    readonly reason: string,
  ) {
    super(`"${platformId}" is not offered by this build. ${reason}`);
    this.name = "ConnectorNotOfferedError";
  }
}

/**
 * What the rules below decided about one platform.
 *
 * A value rather than a thrown error, because two callers need the same
 * decision and only one of them is polling. `only` turns each branch into the
 * error that names its repair; the connections screen turns the same branch
 * into the sentence a person reads beside the platform.
 */
export type ProviderDecision =
  /** One provider will fetch it. `recorded` is false when it was the only one that could. */
  | { readonly status: "chosen"; readonly providerId: ProviderId; readonly recorded: boolean }
  /** Two or more could, and nobody has said which. */
  | { readonly status: "undecided"; readonly providers: readonly ProviderId[] }
  /**
   * This build offers no connector for the platform. US-053.
   *
   * Its own status and not an `unavailable` with an empty list, because the
   * repair is different in kind: nothing a person connects or chooses will
   * change it, and `reason` is the sentence that says so.
   */
  | { readonly status: "off"; readonly reason: string }
  /**
   * None can. `chosen` names the recorded provider when that is the reason,
   * and `reason` says the choice is switched off rather than unconnected.
   */
  | {
      readonly status: "unavailable";
      readonly chosen: ProviderId | null;
      readonly available: readonly ProviderId[];
      /** Why the chosen provider cannot run, when it is switched off. */
      readonly reason?: string;
    };

/**
 * Which provider fetches a platform, from what is registered, what can run,
 * what this build offers, and what somebody chose.
 *
 * The one place the rule is written. `usable` is what this deployment holds a
 * key for; passing `registered` as `usable` asks the question about the build
 * rather than about the deployment.
 *
 * `notOffered` is the fourth input, and it is a build fact where the other
 * three are a deployment's. Pass every registered provider in `registered`,
 * switched-off ones included: this function takes them out itself, so no caller
 * can forget and none has to filter first. Passing only the offered ones would
 * turn a recorded choice naming a switched-off provider into a stale row, and
 * the poll would then quietly bill the other provider — which is the whole
 * failure US-026 refuses.
 */
export function decideProvider(
  platformId: PlatformId,
  registered: readonly ProviderId[],
  usable: readonly ProviderId[],
  choices: ProviderChoices = {},
  notOffered: Readonly<Partial<Record<ProviderId, string>>> = {},
): ProviderDecision {
  const chosen = choices[platformId];
  const offered = (id: ProviderId) => notOffered[id] === undefined;

  // The whole platform is switched off, so no key and no choice can change the
  // answer. Read before the choice, because a recorded choice here is a row
  // from before the switch and not a repair anybody can make.
  const reasons = [...new Set(registered.filter((id) => !offered(id)).map((id) => notOffered[id]))];
  if (registered.length > 0 && reasons.length === registered.length) {
    return { status: "off", reason: reasons.join(" ") };
  }

  const offeredUsable = usable.filter(offered);
  const offeredRegistered = registered.filter(offered);

  if (chosen && offeredUsable.includes(chosen)) {
    return { status: "chosen", providerId: chosen, recorded: true };
  }

  // A choice that names a provider of this platform is obeyed or refused,
  // never quietly replaced. Falling back to the other one would bill an
  // account the person did not pick, at a price they never saw — a lost
  // ScrapeCreators key would move every poll to Bright Data, which charges
  // twenty times as much for the same subreddit page.
  //
  // A switched-off provider is one that cannot run, so a choice naming it is
  // refused the same way. The reason travels, because "connect it" is not the
  // repair here — choosing another provider is.
  if (chosen && registered.includes(chosen)) {
    const reason = notOffered[chosen];
    return {
      status: "unavailable",
      chosen,
      available: offeredUsable,
      ...(reason === undefined ? {} : { reason }),
    };
  }

  // A choice naming a provider that does not fetch this platform at all is a
  // stale or mistyped row rather than a decision about this platform, so it
  // decides nothing and the rules below answer as if it were absent. It still
  // cannot pick for a platform two providers can run.

  // One provider that can run is its own answer, and that is the deployment
  // holding a single key: no question is asked.
  const only = offeredUsable[0];
  if (offeredUsable.length === 1 && only) {
    return { status: "chosen", providerId: only, recorded: false };
  }

  // `available` lists what is left to connect, so a switched-off provider is
  // not in it: telling somebody to connect a connector this build will not run
  // is an instruction that cannot work.
  if (offeredUsable.length === 0) {
    return { status: "unavailable", chosen: null, available: offeredRegistered };
  }

  return { status: "undecided", providers: offeredUsable };
}

export interface SourceRegistry {
  /** The connector for this pair, or `UnknownConnectorError`. Never undefined. */
  get(platformId: PlatformId, providerId: ProviderId): SocialSource;
  has(platformId: PlatformId, providerId: ProviderId): boolean;
  /**
   * The one connector for a platform, given what this deployment can run and
   * what somebody chose.
   *
   * Every caller that has a platform and no provider goes through here, which
   * is why US-026 had one list of callers to give a choice to.
   *
   * It throws rather than returning undefined, and each throw is a different
   * repair. `UnknownSourceError`: nothing fetches this platform, so the build
   * has no connector for it. `ConnectorNotOfferedError`: it has one and offers
   * none of them. `AmbiguousConnectorError`: two providers can run it and
   * nobody has chosen. `NoUsableProviderError`: nothing can run it here, or the
   * recorded choice names a provider that cannot — which includes a choice
   * naming a switched-off provider.
   */
  only(platformId: PlatformId, options?: ChoiceOptions): SocialSource;
  /**
   * Why this build offers no connector for a platform, or null when it offers
   * one. US-053.
   *
   * Null also answers for a platform nothing here fetches: that is
   * `UnknownSourceError`'s question and not this one's.
   */
  notOffered(platformId: PlatformId): string | null;
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

/** What `only` needs beyond the platform, to answer a platform two providers fetch. */
export interface ChoiceOptions {
  /**
   * Which provider fetches a platform, as somebody recorded it.
   *
   * A recorded choice is not a guess: the objection to answering with the
   * first registration is that nobody chose it, and an entry here was chosen
   * by a person on the connections screen. `readProviderChoices` reads them,
   * and the caller reads them per poll rather than at boot — that is what
   * makes a changed choice take effect on the next collection.
   */
  readonly choices?: ProviderChoices;
  /**
   * The providers this deployment can actually run, when the caller knows.
   *
   * The poll narrows to the ones it holds a key for, because "one provider
   * connected" is the common deployment and it must not be asked a question it
   * has only one answer to. Absent means "every registered one", which is the
   * right answer for a caller that is describing the build rather than running
   * it.
   */
  readonly among?: readonly ProviderId[];
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

    if (
      definition.postsPerUnit !== undefined &&
      (!Number.isFinite(definition.postsPerUnit) || definition.postsPerUnit <= 0)
    ) {
      // A zero or negative yield makes the comparison on the pricing page
      // divide by it, and a person choosing a provider on an infinite cost per
      // post would choose the wrong one. Absent is a fine answer; nonsense is
      // not.
      throw new Error(
        `Source "${key.platformId}" says one ${definition.billableUnit} brings back ` +
          `${definition.postsPerUnit} posts, which is not a count of them.`,
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
    only(platformId, { choices = {}, among }: ChoiceOptions = {}) {
      const registered = forPlatform(platformId);
      if (registered.length === 0) throw new UnknownSourceError([platformId], platformIds);

      // What could run, which is not the same as what is registered. A build
      // ships two Reddit connectors; a deployment usually holds one key.
      const usable = among
        ? registered.filter((candidate) => among.includes(candidate.provider.id))
        : registered;

      const decision = decideProvider(
        platformId,
        registered.map((candidate) => candidate.provider.id),
        usable.map((candidate) => candidate.provider.id),
        choices,
        reasonsByProvider(registered, platformId),
      );

      if (decision.status === "off") {
        throw new ConnectorNotOfferedError(platformId, decision.reason);
      }

      if (decision.status === "unavailable") {
        throw new NoUsableProviderError(platformId, decision.chosen, decision.available);
      }

      if (decision.status === "undecided") {
        throw new AmbiguousConnectorError(platformId, decision.providers);
      }

      // Present by construction: the decision named one of these providers.
      return usable.find(
        (candidate) => candidate.provider.id === decision.providerId,
      ) as SocialSource;
    },
    forPlatform,
    // The same rule the screens and the write paths read, asked of what is
    // registered here rather than of a list somebody assembled.
    notOffered: (platformId) => notOfferedReason(forPlatform(platformId), platformId),
    platforms: () => platformIds,
    keys: () => keys,
    list: () => keys.map((key) => connectors.get(keyOf(key)) as SocialSource),
    require(wanted) {
      const missing = [...new Set(wanted)].filter((id) => forPlatform(id).length === 0);
      if (missing.length > 0) throw new UnknownSourceError(missing, platformIds);
    },
  };
}
