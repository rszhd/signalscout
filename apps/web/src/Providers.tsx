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

interface Capabilities {
  keyword: boolean;
  channel: boolean;
  replies: boolean;
  commentLinks: boolean | null;
}

interface Returned {
  posts: number;
  matches: number;
  matchRate: number | null;
  medianAgeHours: number | null;
  costPerMatch: Money | null;
  thin: boolean;
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
  can: Capabilities;
  returned: Returned;
}

interface PlatformView {
  id: string;
  displayName: string;
  comparable: boolean;
  connectors: ConnectorView[];
}

interface ProvidersView {
  comparedPosts: number;
  thinSample: number;
  verdicts: number;
  platforms: PlatformView[];
}

/**
 * An age in the unit a person would say it in.
 *
 * Hours up to two days, then days. "196 h" is a number somebody has to divide;
 * "8 days" is the fact — and against "3 h" it is the whole argument for one
 * provider over another.
 */
function age(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

/** What a connector can find, as words rather than ticks. */
function findsWith(can: Capabilities): string {
  const modes = [can.keyword && "keywords", can.channel && "channels"].filter(Boolean);
  return modes.length > 0 ? modes.join(" and ") : "nothing on its own";
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

function ProvidersHeader() {
  return (
    <header className="topbar">
      <div>
        <h1>Providers</h1>
        <p className="page-subtitle">
          What each provider charges, what it has actually returned here, and what it can find at
          all.
        </p>
      </div>
    </header>
  );
}

export function Providers() {
  const [view, setView] = useState<ProvidersView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    requestJson<ProvidersView>("/api/pricing")
      .then(setView)
      .catch((cause: unknown) => setError(messageFor(cause, "This page could not be loaded.")));
  }, []);

  if (error) {
    return (
      <div className="product-page providers-page">
        <ProvidersHeader />
        <div className="center-state page-state" role="alert">
          <h2>This page could not be loaded</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="product-page providers-page">
        <ProvidersHeader />
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
    <div className="product-page providers-page">
      <ProvidersHeader />

      <div className="providers-content">
        {view.platforms.map((platform) => {
          const cheapest = cheapestOf(platform);

          return (
            <article className="providers-platform" key={platform.id}>
              <h2>
                <BrandIcon brand={platform.id} />
                <span>{platform.displayName}</span>
                {platform.comparable && (
                  <span className="providers-count">{platform.connectors.length} providers</span>
                )}
              </h2>

              <div className="table-scroll">
                <table className="providers-table">
                  <thead>
                    <tr>
                      <th scope="col">Provider</th>
                      <th scope="col">Price</th>
                      <th scope="col">One unit brings</th>
                      <th scope="col">Est. {view.comparedPosts} posts</th>
                      <th scope="col">Spent so far</th>
                      <th scope="col">Posts, and how fresh</th>
                      <th scope="col">Matches</th>
                      <th scope="col">Cost per match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {platform.connectors.map((connector) => (
                      <tr
                        key={connector.providerId}
                        className={connector.inUse ? "providers-row in-use" : "providers-row"}
                      >
                        <th scope="row">
                          <span className="providers-provider">{connector.providerName}</span>
                          <span className="providers-tags">
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
                          {/*
                            Capabilities as facts, not scales. "Cannot search"
                            is not a one out of five, and a connector that reads
                            comments it cannot link to is a different thing from
                            one that can.
                          */}
                          <span className="providers-can">
                            Finds by {findsWith(connector.can)}
                            {connector.can.replies
                              ? connector.can.commentLinks === true
                                ? " · reads and links comments"
                                : connector.can.commentLinks === false
                                  ? " · reads comments, cannot link them"
                                  : " · reads comments, links unproven"
                              : " · no comments"}
                          </span>
                        </th>
                        <td>
                          <span className="providers-money">{connector.pricePerUnit.display}</span>
                          <span className="providers-note">per {connector.billableUnit}</span>
                          {connector.replyPricePerUnit && (
                            <span className="providers-note">
                              {connector.replyPricePerUnit.display} per comment page
                            </span>
                          )}
                        </td>
                        <td>
                          {connector.postsPerUnit === null ? (
                            <span className="providers-note">not measured</span>
                          ) : (
                            <>
                              <span className="providers-money">{connector.postsPerUnit}</span>
                              <span className="providers-note">
                                post{connector.postsPerUnit === 1 ? "" : "s"} per{" "}
                                {connector.billableUnit}
                              </span>
                            </>
                          )}
                        </td>
                        <td>
                          {connector.estimatedPerComparedPosts === null ? (
                            <span className="providers-note">
                              no yield measured, so nothing to compare
                            </span>
                          ) : (
                            <>
                              <span
                                className={
                                  connector.estimatedPerComparedPosts.micros === cheapest
                                    ? "providers-money providers-best"
                                    : "providers-money"
                                }
                              >
                                {connector.estimatedPerComparedPosts.display}
                              </span>
                              <span className="providers-note">
                                {connector.estimatedPerComparedPosts.micros === cheapest
                                  ? "estimated — cheapest here"
                                  : "estimated"}
                              </span>
                            </>
                          )}
                        </td>
                        <td>
                          {connector.spent.cost.micros === 0 ? (
                            <span className="providers-note">nothing yet</span>
                          ) : (
                            <>
                              <span className="providers-money">
                                {connector.spent.cost.display}
                              </span>
                              <span className="providers-note">
                                {connector.spent.units} {connector.billableUnit}
                                {connector.spent.units === 1 ? "" : "s"} billed
                              </span>
                            </>
                          )}
                        </td>
                        <td>
                          {connector.returned.posts === 0 ? (
                            <span className="providers-note">none collected</span>
                          ) : (
                            <>
                              <span className="providers-money">{connector.returned.posts}</span>
                              {/*
                                Freshness, and the reason this column exists. A
                                median of 3 hours against 8 days is the whole
                                argument for one provider over another, and no
                                price on this page says it.
                              */}
                              <span className="providers-note">
                                median age {age(connector.returned.medianAgeHours)}
                              </span>
                            </>
                          )}
                        </td>
                        <td>
                          {connector.returned.matchRate === null ? (
                            // 0 of 0 is not zero per cent, and printing one
                            // would read as a measurement of a provider nobody
                            // has used.
                            <span className="providers-note">nothing to judge yet</span>
                          ) : (
                            <>
                              <span className="providers-money">
                                {connector.returned.matches} · {connector.returned.matchRate}%
                              </span>
                              <span className="providers-note">
                                of {connector.returned.posts} posts
                                {connector.returned.thin ? " — too few to lean on" : ""}
                              </span>
                            </>
                          )}
                        </td>
                        <td>
                          {connector.returned.costPerMatch === null ? (
                            <span className="providers-note">—</span>
                          ) : (
                            <>
                              <span className="providers-money">
                                {connector.returned.costPerMatch.display}
                              </span>
                              <span className="providers-note">
                                {connector.returned.thin ? "over a thin sample" : "measured"}
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

      <footer className="providers-footnotes">
        <p>
          <strong>Spent so far, everything: {`$${(totalSpent / 1_000_000).toFixed(4)}`}.</strong>{" "}
          This is what this instance has recorded against every provider, all time. It is our count
          of what you were charged, not a bill — read it beside your provider's own dashboard.
        </p>
        <p>
          <strong>A match is our guess. A verdict is yours.</strong> The classifier scores a post
          against your monitor, and a match only means it scored above the threshold — the two
          matches this instance found on one LinkedIn provider were marketing. Only a verdict says a
          lead was any good, and there {view.verdicts === 1 ? "is" : "are"}{" "}
          {view.verdicts === 0 ? "none" : view.verdicts} so far. Until there are more, read “cost
          per match” as the cost of something worth reading, not the cost of a customer.
        </p>
        <p>
          A provider can show money spent and no posts. Rows collected before this instance started
          recording <em>which</em> provider fetched them carry no provider, and they are left out
          rather than credited to whichever one is listed first — so the spend is real and the posts
          are counted under nobody.
        </p>
        <p>
          Match rate is only comparable <em>between two providers of one platform</em>. Across
          platforms it measures the monitor and its threshold rather than the provider. Anything
          under {view.thinSample} posts is marked, because a percentage over twenty posts is two
          matches either way.
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
