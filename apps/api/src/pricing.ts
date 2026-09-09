/**
 * What every provider charges, on one page, so two of them can be compared.
 *
 * US-058. Nine connectors ship and their prices are in four different units —
 * Bright Data bills a record, ScrapeCreators a request, SocialCrawl a credit,
 * Apify a post. $1.50 per 1,000 records and $8.12 per 1,000 credits are not two
 * numbers a person can put side by side, so this route does the one piece of
 * arithmetic that makes them comparable and shows its working.
 *
 * Three kinds of number leave here and they must not be confused on the screen:
 *
 * * **A declared price.** A fact about somebody else's product, read on a date
 *   and written into a connector. It is exact, and it can be out of date.
 * * **An estimate.** The declared price multiplied by a measured yield. It is
 *   the comparable number and it is the least reliable one, because the yield
 *   came from one capture run of one query.
 * * **A spend.** What `api_usage` says this deployment already paid through
 *   that pair. It is money gone, and it is the only figure here that is not a
 *   projection — which makes it the strongest thing to compare two providers
 *   on, because it is the person's own account rather than our arithmetic.
 *
 * docs/costs.md governs all three. Nothing is rounded to cents: ten Reddit
 * records cost $0.015, and a screen showing two cents cannot be reconciled
 * against anything.
 */
import type {
  ConnectorDescriptor,
  Database,
  PlatformDescriptor,
  ProviderId,
} from "@signalscout/core";
import {
  decideProvider,
  environmentVariableFor,
  groupByPlatform,
  listCredentialHints,
  offeredConnectors,
  providerReturns,
  readProviderChoices,
  spendByPair,
  verdictCount,
} from "@signalscout/core";
import { z } from "zod";
import { sessionUserId } from "./auth.js";
import type { ApiServer } from "./server.js";

/**
 * Below this many posts, a percentage is noise dressed as a measurement.
 *
 * US-059's own example: LinkedIn matched at 25.0% through one provider and
 * 8.0% through another, over twenty and twenty-five posts. Two matches either
 * way. The screen marks a row this thin rather than hiding it — the number is
 * still the only one there is, and a person who knows it rests on twenty posts
 * can weigh it themselves.
 */
export const thinSample = 50;

/**
 * The quantity every connector is priced for, so the column is one comparison
 * rather than nine.
 *
 * Fifty because it is the size of a real collection — Bright Data's default
 * input is fifty records, and US-022's live subreddit poll returned exactly
 * fifty posts — so the figure is a poll a person can picture rather than a
 * per-unit abstraction they have to multiply.
 */
export const comparedPosts = 50;

export interface PricingRoutesOptions {
  readonly db: Database;
  readonly sources: readonly ConnectorDescriptor[];
  readonly environment?: Record<string, string | undefined>;
}

const money = z.object({
  micros: z.number(),
  /** Already formatted, because four decimal places is a rule and not a taste. */
  display: z.string(),
});

const connectorView = z.object({
  providerId: z.string(),
  providerName: z.string(),
  billableUnit: z.string(),
  pricePerUnit: money,
  /** Null when nobody has measured what one unit brings back. */
  postsPerUnit: z.number().nullable(),
  /** Null for the same reason: without a yield there is nothing to compare. */
  estimatedPerComparedPosts: money.nullable(),
  /** Null unless this connector reads replies and prices them separately. */
  replyPricePerUnit: money.nullable(),
  /** What one query may cost in one poll, at this connector's own ceiling. */
  ceilingPerQueryPoll: money,
  connected: z.boolean(),
  missingEnvironmentVariables: z.array(z.string()),
  /** Whether a poll of this platform would actually go through this provider. */
  inUse: z.boolean(),
  spent: z.object({ units: z.number(), cost: money }),
  /** What this pair can find, and whether a comment it returns can be opened. */
  can: z.object({
    keyword: z.boolean(),
    channel: z.boolean(),
    replies: z.boolean(),
    /** Null where nobody has opened one of this connector's comment links. */
    commentLinks: z.boolean().nullable(),
  }),
  /**
   * What this pair actually brought back, from this deployment's own rows.
   *
   * The half that answers whether the money was well spent. Every figure here
   * is counted rather than projected, and `thin` says when there is too little
   * of it to lean on.
   */
  returned: z.object({
    posts: z.number(),
    matches: z.number(),
    /** Null when nothing was collected: 0 of 0 is not zero per cent. */
    matchRate: z.number().nullable(),
    /** Hours, median, of the posts collected through this pair. Null when none. */
    medianAgeHours: z.number().nullable(),
    /** What one match cost through this pair. Null with no spend or no matches. */
    costPerMatch: money.nullable(),
    thin: z.boolean(),
  }),
});

const platformView = z.object({
  id: z.string(),
  displayName: z.string(),
  /** True when more than one connector here can run, which is when a choice matters. */
  comparable: z.boolean(),
  connectors: z.array(connectorView),
});

/**
 * Four decimal places, never two.
 *
 * docs/costs.md: ten Reddit records cost $0.015, and a page that rounded that
 * to two cents could not be reconciled against a provider's dashboard. The
 * rule is the same everywhere a figure is shown, so it lives in one function.
 */
export function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

function moneyOf(micros: number) {
  return { micros, display: formatMicros(micros) };
}

/**
 * What the same fifty posts cost through this connector.
 *
 * The one number that makes four different billable units comparable, and the
 * least reliable number on the page: the yield behind it came from one capture
 * of one query, and a different query on the same connector can return a
 * different number of posts per unit. The screen labels it an estimate for
 * exactly that reason.
 *
 * Rounded up. A fraction of a micro-dollar cannot be shown honestly, and
 * rounding down would quote a provider as cheaper than it is.
 */
function estimateFor(connector: ConnectorDescriptor): number | null {
  const yieldPerUnit = connector.postsPerUnit;
  if (yieldPerUnit === undefined) return null;

  return Math.ceil((comparedPosts / yieldPerUnit) * connector.pricePerUnitMicros);
}

export async function registerPricingRoutes(
  app: ApiServer,
  options: PricingRoutesOptions,
): Promise<void> {
  const { db, sources } = options;
  const environment = options.environment ?? process.env;
  const platforms = groupByPlatform(sources);

  app.route({
    method: "GET",
    url: "/api/pricing",
    schema: {
      response: {
        200: z.object({
          comparedPosts: z.number(),
          thinSample: z.number(),
          /**
           * How many verdicts this instance holds, in total.
           *
           * The page says a match is our guess and a verdict is the person's
           * judgement, and this number is what makes that concrete. With five
           * verdicts on one monitor, "cost per good lead" is not a figure
           * anybody may compute, and the screen says so rather than showing
           * matches and calling them leads.
           */
          verdicts: z.number(),
          platforms: z.array(platformView),
        }),
      },
    },
    handler: async (request) => {
      const userId = sessionUserId(request);
      const hints = await listCredentialHints(db, userId);
      const stored = new Set(hints.map((hint) => `${hint.provider}:${hint.field}`));
      const choices = await readProviderChoices(db, userId);

      /**
       * One query for every pair's spend, rather than one per row.
       *
       * All time rather than this month. A cap is monthly and this page is not
       * a cap: somebody comparing two providers wants everything they have
       * ever paid each one, and a provider switched away from last month would
       * otherwise show as free.
       */
      /**
       * All time rather than this month. A cap is monthly and this page is not
       * a cap: somebody comparing two providers wants everything they have
       * ever paid each one, and a provider switched away from last month would
       * otherwise show as free.
       *
       * Scoped to the person asking. BUG-009: it was the instance's spend, so
       * an account that had just registered was shown somebody else's.
       */
      const spending = await spendByPair(db, sessionUserId(request));

      const spentBy = new Map<string, { units: number; micros: number }>();

      for (const row of spending) {
        spentBy.set(`${row.source}:${row.provider}`, { units: row.units, micros: row.micros });
      }

      /**
       * What each pair collected, and how much of it became a match.
       *
       * One query rather than one per row, and it counts `posts` rather than
       * anything a connector reported: this is what is in the table, which is
       * what a person can check.
       *
       * `posts.provider` is null on rows collected before US-024 split the
       * platform from the provider — 126 Reddit posts on this instance. They
       * belong to no pair and are excluded rather than being attributed to
       * whichever provider happens to be listed first.
       */
      const returns = await providerReturns(db, sessionUserId(request));
      const returnedBy = new Map(returns.map((row) => [`${row.source}:${row.provider}`, row]));

      const verdicts = await verdictCount(db, sessionUserId(request));

      /** Which credential fields this deployment is missing for one provider. */
      function missingFor(connector: ConnectorDescriptor): string[] {
        return connector.provider.credentialFields
          .filter((field) => {
            const variable = environmentVariableFor(connector.provider.id, field.name);
            return !stored.has(`${connector.provider.id}:${field.name}`) && !environment[variable];
          })
          .map((field) => environmentVariableFor(connector.provider.id, field.name));
      }

      function viewOf(platform: PlatformDescriptor) {
        // A switched-off connector is not on the comparison, because the page
        // is what a person may choose between. US-053: the platform itself
        // stays while another provider still fetches it, and `groupByPlatform`
        // has already dropped it when none does.
        const connectors = offeredConnectors(sources).filter(
          (source) => source.platform.id === platform.id,
        );
        const usable = connectors.filter((connector) => missingFor(connector).length === 0);

        /**
         * Which provider a poll would really use, by the one rule every screen
         * and the worker share.
         *
         * Asking `decideProvider` rather than reading the recorded choice: a
         * choice that cannot run is refused rather than replaced, and one
         * provider that can run is its own answer with nothing recorded. A page
         * that showed the recorded row would tell a person their polls go
         * somewhere they do not.
         */
        const decision = decideProvider(
          platform.id,
          connectors.map((connector) => connector.provider.id),
          usable.map((connector) => connector.provider.id),
          choices,
        );

        const chosen: ProviderId | undefined =
          decision.status === "chosen" ? decision.providerId : undefined;

        return {
          id: platform.id,
          displayName: platform.displayName,
          comparable: connectors.length > 1,
          connectors: connectors.map((connector) => {
            const missing = missingFor(connector);
            const spent = spentBy.get(`${platform.id}:${connector.provider.id}`) ?? {
              units: 0,
              micros: 0,
            };
            const estimate = estimateFor(connector);
            const back = returnedBy.get(`${platform.id}:${connector.provider.id}`);

            const collected = back?.posts ?? 0;
            const matched = back?.matches ?? 0;
            const median =
              back?.medianAgeHours === null || back?.medianAgeHours === undefined
                ? null
                : Math.round(Number(back.medianAgeHours) * 10) / 10;

            return {
              providerId: connector.provider.id,
              providerName: connector.provider.displayName,
              billableUnit: connector.billableUnit,
              pricePerUnit: moneyOf(connector.pricePerUnitMicros),
              postsPerUnit: connector.postsPerUnit ?? null,
              estimatedPerComparedPosts: estimate === null ? null : moneyOf(estimate),
              replyPricePerUnit:
                connector.canFetchReplies === true &&
                connector.replyPricePerUnitMicros !== undefined
                  ? moneyOf(connector.replyPricePerUnitMicros)
                  : null,
              ceilingPerQueryPoll: moneyOf(
                connector.maxUnitsPerQueryPoll * connector.pricePerUnitMicros,
              ),
              connected: missing.length === 0,
              missingEnvironmentVariables: missing,
              inUse: chosen === connector.provider.id,
              spent: { units: spent.units, cost: moneyOf(spent.micros) },
              can: {
                keyword: connector.discovery?.includes("keyword") ?? false,
                channel: connector.discovery?.includes("channel") ?? false,
                replies: connector.canFetchReplies === true,
                commentLinks: connector.linksToComments ?? null,
              },
              returned: {
                posts: collected,
                matches: matched,
                // 0 of 0 is not zero per cent. A pair that has collected
                // nothing has no rate, and showing one would read as a
                // measurement of a provider nobody has used.
                matchRate: collected === 0 ? null : Math.round((matched / collected) * 1000) / 10,
                medianAgeHours: median,
                // What one match cost through this pair. Undefined rather than
                // infinite when nothing matched: a provider that produced no
                // lead has no cost per lead, and dividing by zero would print
                // the most expensive provider as blank and the second most as
                // a number.
                costPerMatch:
                  matched === 0 || spent.micros === 0
                    ? null
                    : moneyOf(Math.round(spent.micros / matched)),
                thin: collected > 0 && collected < thinSample,
              },
            };
          }),
        };
      }

      return {
        comparedPosts,
        thinSample,
        verdicts,
        platforms: platforms.map(({ platform }) => viewOf(platform)),
      };
    },
  });
}
