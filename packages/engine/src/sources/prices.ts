/**
 * An instance's own prices for its providers. US-389.
 *
 * Correctness-critical: the budget guard. Every connector declares its
 * provider's dearest price, so a figure is high and never low. An instance
 * that buys a larger pack pays less, and without this its allowances fill
 * faster than its money is spent. The failure shape this file must avoid is
 * the opposite one: a price that reaches the definition and not the connector
 * the registry builds, so one reader counts the paid price and another the
 * list price, and a cap is judged on the wrong one.
 *
 * So the prices are applied to the definitions, and each priced definition
 * builds a connector that reports the same prices. A caller passes the priced
 * list everywhere it passed the list before.
 */
import type { ConnectorDefinition, ProviderId, SocialSource } from "./types.js";

/** What this instance pays for one of a provider's own units, in micro-dollars. */
export type ProviderPrices = Readonly<Record<ProviderId, number>>;

/**
 * One declared price, moved by the ratio of the paid unit price to the list
 * one. A connector priced at a whole number of units stays exact; anything
 * else rounds up, the direction every price in this repository rounds.
 */
function scaled(declared: number, listUnit: number, paidUnit: number): number {
  return declared % listUnit === 0
    ? (declared / listUnit) * paidUnit
    : Math.ceil((declared * paidUnit) / listUnit);
}

export function withInstancePrices(
  definitions: readonly ConnectorDefinition[],
  prices: ProviderPrices,
): readonly ConnectorDefinition[] {
  const named = new Map(definitions.map((definition) => [definition.provider.id, definition]));

  for (const [providerId, price] of Object.entries(prices)) {
    const definition = named.get(providerId);

    if (!definition) {
      // A misspelled id would price nothing and say nothing.
      throw new Error(
        `A price is given for provider "${providerId}", and no connector here is fetched by it.`,
      );
    }

    if (!Number.isInteger(price) || price <= 0) {
      throw new Error(
        `The price given for provider "${providerId}" is ${price} micro-dollars. ` +
          "It must be a whole number above zero: anything else would hide what is spent.",
      );
    }

    if (definition.provider.unitPriceMicros === undefined) {
      throw new Error(
        `Provider "${providerId}" has no list price for one of its units, so a price ` +
          "paid for it cannot be applied to its connectors.",
      );
    }
  }

  return definitions.map((definition) => {
    const paid = prices[definition.provider.id];
    const listUnit = definition.provider.unitPriceMicros;
    if (paid === undefined || listUnit === undefined) return definition;

    const pricePerUnitMicros = scaled(definition.pricePerUnitMicros, listUnit, paid);
    const replyPricePerUnitMicros =
      definition.replyPricePerUnitMicros === undefined
        ? undefined
        : scaled(definition.replyPricePerUnitMicros, listUnit, paid);

    const paidPrices = {
      pricePerUnitMicros,
      ...(replyPricePerUnitMicros === undefined ? {} : { replyPricePerUnitMicros }),
    };

    return {
      ...definition,
      ...paidPrices,
      /**
       * The connector, with the two prices shadowed and everything else
       * reached through it: its methods and its own state are the original's.
       */
      create: (runtime) => {
        const connector = definition.create(runtime);
        return Object.create(connector, {
          pricePerUnitMicros: { value: pricePerUnitMicros, enumerable: true },
          ...(replyPricePerUnitMicros === undefined
            ? {}
            : { replyPricePerUnitMicros: { value: replyPricePerUnitMicros, enumerable: true } }),
        }) as SocialSource;
      },
    };
  });
}
