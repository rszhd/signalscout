import type { SocialSource, SourceDefinition, SourceId, SourceRuntime } from "./types.js";
import { sourceIdPattern } from "./types.js";

/**
 * Thrown when something asks for a source that is not registered.
 *
 * The message lists what is registered, because the reader is looking at a
 * crashed boot and needs to know whether the connector is missing or the id is
 * misspelled: `Unknown source "bluesky". Registered sources: reddit, x.`
 */
export class UnknownSourceError extends Error {
  constructor(
    readonly missing: readonly SourceId[],
    readonly known: readonly SourceId[],
  ) {
    const subject = missing.length === 1 ? "source" : "sources";
    super(
      `Unknown ${subject} ${missing.map((id) => `"${id}"`).join(", ")}. ` +
        `Registered sources: ${known.join(", ") || "(none)"}.`,
    );
    this.name = "UnknownSourceError";
  }
}

export interface SourceRegistry {
  /** The source, or `UnknownSourceError`. There is no undefined answer. */
  get(id: SourceId): SocialSource;
  has(id: SourceId): boolean;
  /** Every registered id, in the order the definitions were given. */
  ids(): readonly SourceId[];
  list(): readonly SocialSource[];
  /**
   * Throw unless every id is registered, naming all of the missing ones.
   *
   * The collector calls this once at boot with the ids its monitors name, so a
   * missing connector stops the process instead of failing one poll, quietly,
   * every hour.
   */
  require(ids: Iterable<SourceId>): void;
}

export interface CreateSourceRegistryOptions {
  readonly definitions: readonly SourceDefinition[];
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
  const sources = new Map<SourceId, SocialSource>();

  for (const definition of definitions) {
    if (!sourceIdPattern.test(definition.id)) {
      throw new Error(
        `Source id "${definition.id}" is not usable. ` +
          "An id is lower-case letters, digits and hyphens, and starts with a letter.",
      );
    }

    if (sources.has(definition.id)) {
      throw new Error(`Two sources are registered as "${definition.id}".`);
    }

    if (!Number.isInteger(definition.pricePerUnitMicros) || definition.pricePerUnitMicros < 0) {
      // A fractional or negative price makes every later budget sum wrong by
      // an amount nobody can reconstruct from the stored totals.
      throw new Error(
        `Source "${definition.id}" prices one ${definition.billableUnit} at ` +
          `${definition.pricePerUnitMicros} micro-dollars, which is not a whole number of them.`,
      );
    }

    if (!Number.isInteger(definition.maxUnitsPerQueryPoll) || definition.maxUnitsPerQueryPoll < 1) {
      // US-014 multiplies this by the polls in a month. A zero here would
      // report every plan on this source as costing nothing, which is the one
      // wrong answer a cost screen must never give.
      throw new Error(
        `Source "${definition.id}" says one query costs at most ` +
          `${definition.maxUnitsPerQueryPoll} ${definition.billableUnit}s in a poll. ` +
          "It has to be a whole number, and at least one.",
      );
    }

    sources.set(definition.id, definition.create(runtime));
  }

  const ids = [...sources.keys()];

  return {
    get(id) {
      const source = sources.get(id);
      if (!source) throw new UnknownSourceError([id], ids);
      return source;
    },
    has: (id) => sources.has(id),
    ids: () => ids,
    list: () => [...sources.values()],
    require(wanted) {
      const missing = [...new Set(wanted)].filter((id) => !sources.has(id));
      if (missing.length > 0) throw new UnknownSourceError(missing, ids);
    },
  };
}
