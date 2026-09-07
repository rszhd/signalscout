import { useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";
import { BrandIcon } from "./BrandIcon.js";

/**
 * What every provider charges, on one page, so two of them can be compared.
 *
 * US-058. The connections screen says which accounts are connected and the
 * cost test says what one plan would cost; neither answers "which of these two
 * is cheaper", because the prices are in four different units. Bright Data
 * bills a record, ScrapeCreators a request, SocialCrawl a credit and Apify a
 * post, and $1.50 per 1,000 records against $8.12 per 1,000 credits is not a
 * comparison anybody can do in their head.
 *
 * **The comparable column is the point of the screen**, and it is also the
 * least reliable thing on it. It is a declared price multiplied by a measured
 * yield, and the yield came from one capture of one query. So it is labelled an
 * estimate, the yield it rests on is printed beside it, and the money already
 * spent — which is not a projection at all — sits in the same row.
 *
 * Three kinds of number, and the screen keeps them apart on purpose:
 *
 * * the **price**, a fact about somebody else's product;
 * * the **estimate**, our arithmetic over that price;
 * * the **spend**, money that has already left the person's account.
 *
 * Nothing is rounded to cents. docs/costs.md: ten Reddit records cost $0.015,
 * and a screen showing two cents cannot be reconciled against a dashboard.
 */

interface Money {
  micros: number;
  display: string;
}

interface ConnectorView {
  providerId: string;
  providerName: string;
  billableUnit: string;
  pricePerUnit: Money;
  postsPerUnit: number | null;
  estimatedPerComparedPosts: Money | null;
  replyPricePerUnit: Money | null;
  ceilingPerQueryPoll: Money;
  connected: boolean;
  missingEnvironmentVariables: string[];
  inUse: boolean;
  spent: { units: number; cost: Money };
}

interface PlatformView {
  id: string;
  displayName: string;
  comparable: boolean;
  connectors: ConnectorView[];
}

interface PricingView {
  comparedPosts: number;
  platforms: PlatformView[];
}

/**
 * The cheapest estimate among a platform's connectors, or nothing.
 *
 * Only a platform with two of them gets the marker: on a platform with one
 * provider "cheapest" is a label with no alternative, and it would read as a
 * recommendation over a choice nobody has.
 */
function cheapestOf(platform: PlatformView): number | undefined {
  if (!platform.comparable) return undefined;

  const priced = platform.connectors
    .map((connector) => connector.estimatedPerComparedPosts?.micros)
    .filter((micros): micros is number => micros !== undefined);

  return priced.length > 1 ? Math.min(...priced) : undefined;
}

function PricingHeader() {
  return (
    <header className="topbar">
      <div>
        <h1>Provider pricing</h1>
        <p className="page-subtitle">
          What each provider charges, and what the same amount of posts costs through each one.
        </p>
      </div>
    </header>
  );
}

export function Pricing() {
  const [view, setView] = useState<PricingView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    requestJson<PricingView>("/api/pricing")
      .then(setView)
      .catch((cause: unknown) => setError(messageFor(cause, "The prices could not be loaded.")));
  }, []);

  if (error) {
    return (
      <div className="product-page pricing-page">
        <PricingHeader />
        <div className="center-state page-state" role="alert">
          <h2>The prices could not be loaded</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="product-page pricing-page">
        <PricingHeader />
        <div className="center-state page-state" role="status">
          <div className="spinner" aria-hidden="true" />
          <p>Reading what each provider charges.</p>
        </div>
      </div>
    );
  }

  const totalSpent = view.platforms
    .flatMap((platform) => platform.connectors)
    .reduce((sum, connector) => sum + connector.spent.cost.micros, 0);

  return (
    <div className="product-page pricing-page">
      <PricingHeader />

      <div className="pricing-content">
        {view.platforms.map((platform) => {
          const cheapest = cheapestOf(platform);

          return (
            <article className="pricing-platform" key={platform.id}>
              <h2>
                <BrandIcon brand={platform.id} />
                <span>{platform.displayName}</span>
                {platform.comparable && (
                  <span className="pricing-count">{platform.connectors.length} providers</span>
                )}
              </h2>

              <div className="table-scroll">
                <table className="pricing-table">
                  <thead>
                    <tr>
                      <th scope="col">Provider</th>
                      <th scope="col">Price</th>
                      <th scope="col">One unit brings</th>
                      <th scope="col">Est. {view.comparedPosts} posts</th>
                      <th scope="col">Max per query, per poll</th>
                      <th scope="col">Spent so far</th>
                    </tr>
                  </thead>
                  <tbody>
                    {platform.connectors.map((connector) => (
                      <tr
                        key={connector.providerId}
                        className={connector.inUse ? "pricing-row in-use" : "pricing-row"}
                      >
                        <th scope="row">
                          <span className="pricing-provider">{connector.providerName}</span>
                          <span className="pricing-tags">
                            {/*
                            "In use" is what a poll would really do, not what a
                            row in the database says: a recorded choice that
                            cannot run is refused rather than replaced, and one
                            usable provider is its own answer with nothing
                            recorded.
                          */}
                            {connector.inUse && <span className="tag tag-strong">In use</span>}
                            {!connector.connected && (
                              <span
                                className="tag tag-quiet"
                                title={connector.missingEnvironmentVariables.join(", ")}
                              >
                                No key
                              </span>
                            )}
                          </span>
                        </th>
                        <td>
                          <span className="pricing-money">{connector.pricePerUnit.display}</span>
                          <span className="pricing-note">per {connector.billableUnit}</span>
                          {connector.replyPricePerUnit && (
                            <span className="pricing-note">
                              {connector.replyPricePerUnit.display} per comment page
                            </span>
                          )}
                        </td>
                        <td>
                          {connector.postsPerUnit === null ? (
                            <span className="pricing-note">not measured</span>
                          ) : (
                            <>
                              <span className="pricing-money">{connector.postsPerUnit}</span>
                              <span className="pricing-note">
                                post{connector.postsPerUnit === 1 ? "" : "s"} per{" "}
                                {connector.billableUnit}
                              </span>
                            </>
                          )}
                        </td>
                        <td>
                          {connector.estimatedPerComparedPosts === null ? (
                            <span className="pricing-note">
                              no yield measured, so nothing to compare
                            </span>
                          ) : (
                            <>
                              <span
                                className={
                                  connector.estimatedPerComparedPosts.micros === cheapest
                                    ? "pricing-money pricing-best"
                                    : "pricing-money"
                                }
                              >
                                {connector.estimatedPerComparedPosts.display}
                              </span>
                              <span className="pricing-note">
                                {connector.estimatedPerComparedPosts.micros === cheapest
                                  ? "estimated — cheapest here"
                                  : "estimated"}
                              </span>
                            </>
                          )}
                        </td>
                        <td>
                          <span className="pricing-money">
                            {connector.ceilingPerQueryPoll.display}
                          </span>
                          <span className="pricing-note">ceiling</span>
                        </td>
                        <td>
                          {connector.spent.cost.micros === 0 ? (
                            <span className="pricing-note">nothing yet</span>
                          ) : (
                            <>
                              <span className="pricing-money">{connector.spent.cost.display}</span>
                              <span className="pricing-note">
                                {connector.spent.units} {connector.billableUnit}
                                {connector.spent.units === 1 ? "" : "s"} billed
                              </span>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          );
        })}
      </div>

      <footer className="pricing-footnotes">
        <p>
          <strong>Spent so far, everything: {`$${(totalSpent / 1_000_000).toFixed(4)}`}.</strong>{" "}
          This is what this instance has recorded against every provider, all time. It is our count
          of what you were charged, not a bill — read it beside your provider's own dashboard.
        </p>
        <p>
          The estimate multiplies a provider's published price by how many posts one unit brought
          back when we measured it. Both come from a real run against a real account, and both can
          be out of date or wrong for your query: a Reddit keyword request returned 7 posts where a
          subreddit request returned 23. Where two figures were measured, the smaller yield is used,
          so the estimate leans expensive rather than cheap.
        </p>
        <p>
          Amounts are shown to four decimal places on purpose. Ten Reddit records cost $0.0150, and
          a page rounding that to two cents could not be checked against anything.
        </p>
      </footer>
    </div>
  );
}
