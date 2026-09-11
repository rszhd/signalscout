// biome-ignore-all lint/a11y/noRedundantRoles: the roles are not redundant at phone width, where the stylesheet gives every table element `display: block` and the implicit table semantics go with it. US-123.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { messageFor, requestJson } from "./api.js";
import { BrandIcon } from "./BrandIcon.js";
import { paths } from "./route.js";

/**
 * The provider comparison keeps three different kinds of money visibly apart:
 * a provider's price, our estimate over a measured yield, and recorded spend.
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

/** Turn an age into the unit a person would naturally use. */
function age(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

function findsWith(can: Capabilities): string {
  const modes = [can.keyword && "keywords", can.channel && "channels"].filter(Boolean);
  return modes.length > 0 ? modes.join(" and ") : "nothing on its own";
}

function commentCapability(can: Capabilities): string {
  if (!can.replies) return "no comments";
  if (can.commentLinks === true) return "reads and links comments";
  if (can.commentLinks === false) return "reads comments, cannot link them";
  return "reads comments, links unproven";
}

/** Only mark a lowest estimate when the platform offers a real comparison. */
function cheapestOf(platform: PlatformView): number | undefined {
  if (!platform.comparable) return undefined;

  const priced = platform.connectors
    .map((connector) => connector.estimatedPerComparedPosts?.micros)
    .filter((micros): micros is number => micros !== undefined);

  return priced.length > 1 ? Math.min(...priced) : undefined;
}

function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

function ProvidersHeader() {
  return (
    <header className="topbar">
      <div>
        <h1>Providers</h1>
        <p className="page-subtitle">
          Compare cost, coverage, and the results each provider has delivered here.
        </p>
      </div>
      <Link className="top-secondary-link" to={paths.connections}>
        Manage connections
      </Link>
    </header>
  );
}

function ProviderRow({
  connector,
  cheapest,
  comparedPosts,
}: {
  connector: ConnectorView;
  cheapest: number | undefined;
  comparedPosts: number;
}) {
  const isCheapest = connector.estimatedPerComparedPosts?.micros === cheapest;

  /*
    Every cell names its column, and every element names its role. US-123.

    Seven columns do not fit a phone, so below 600px each row becomes a card
    and the `data-label` is what the column heading said. The roles are
    written out because changing `display` on table elements takes the table
    semantics with it.
  */
  return (
    <tr
      role="row"
      className={connector.inUse ? "provider-row provider-row-in-use" : "provider-row"}
    >
      <th scope="row" role="rowheader">
        <div className="provider-name-cell">
          <span className="provider-logo" aria-hidden="true">
            <BrandIcon brand={connector.providerId} size={24} />
          </span>
          <div>
            <strong>{connector.providerName}</strong>
            <span>{connector.connected ? "Ready to run" : "Connection required"}</span>
            <span className="providers-tags">
              {connector.inUse && <span className="tag tag-strong">In use</span>}
              {!connector.connected && (
                <span
                  className="tag tag-warning"
                  title={connector.missingEnvironmentVariables.join(", ")}
                >
                  No key
                </span>
              )}
            </span>
          </div>
        </div>
      </th>
      <td role="cell" data-label={`Est. ${comparedPosts} posts`} className="provider-estimate-cell">
        {connector.estimatedPerComparedPosts === null ? (
          <>
            <span>Not measured</span>
            <small>no yield measured, so nothing to compare</small>
          </>
        ) : (
          <>
            <strong>{connector.estimatedPerComparedPosts.display}</strong>
            <small>{isCheapest ? "estimated — cheapest here" : "estimated"}</small>
          </>
        )}
      </td>
      <td role="cell" data-label="Rate & yield">
        <strong>{connector.pricePerUnit.display}</strong>
        <small>per {connector.billableUnit}</small>
        {connector.postsPerUnit === null ? (
          <small>yield not measured</small>
        ) : (
          <small>
            {connector.postsPerUnit} post{connector.postsPerUnit === 1 ? "" : "s"} per{" "}
            {connector.billableUnit}
          </small>
        )}
        {connector.replyPricePerUnit && (
          <small>{connector.replyPricePerUnit.display} per comment page</small>
        )}
        <small>max {connector.ceilingPerQueryPoll.display} per query poll</small>
      </td>
      <td role="cell" data-label="Coverage">
        <span className="provider-coverage">Finds by {findsWith(connector.can)}</span>
        <small>{commentCapability(connector.can)}</small>
      </td>
      <td role="cell" data-label="Spent so far">
        {connector.spent.cost.micros === 0 ? (
          <span>nothing yet</span>
        ) : (
          <>
            <strong>{connector.spent.cost.display}</strong>
            <small>
              {connector.spent.units} {connector.billableUnit}
              {connector.spent.units === 1 ? "" : "s"} billed
            </small>
          </>
        )}
      </td>
      <td role="cell" data-label="Posts & freshness">
        {connector.returned.posts === 0 ? (
          <span>none collected</span>
        ) : (
          <>
            <strong>{connector.returned.posts}</strong>
            <small>median age {age(connector.returned.medianAgeHours)}</small>
          </>
        )}
      </td>
      <td role="cell" data-label="Matches">
        {connector.returned.matchRate === null ? (
          <span>nothing to judge yet</span>
        ) : (
          <>
            <strong>
              {connector.returned.matches} · {connector.returned.matchRate}%
            </strong>
            <small>
              of {connector.returned.posts} posts
              {connector.returned.thin ? " — too few to lean on" : ""}
            </small>
          </>
        )}
        {connector.returned.costPerMatch && (
          <small>
            {connector.returned.costPerMatch.display} per match
            {connector.returned.thin ? " — over a thin sample" : " — measured"}
          </small>
        )}
      </td>
    </tr>
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

  const connectors = view.platforms.flatMap((platform) => platform.connectors);
  const totalSpent = connectors.reduce((sum, connector) => sum + connector.spent.cost.micros, 0);
  const activeProviders = connectors.filter((connector) => connector.inUse).length;

  return (
    <div className="product-page providers-page">
      <ProvidersHeader />

      <div className="providers-content">
        <section className="providers-overview" aria-labelledby="providers-overview-title">
          <div className="providers-overview-copy">
            <p className="eyebrow">Provider economics</p>
            <h2 id="providers-overview-title">Compare like with like</h2>
            <p>
              Published rates use different billing units. The primary figure converts each one to
              the same {view.comparedPosts}-post estimate using yields measured in real runs.
            </p>
          </div>
          <dl className="providers-overview-stats">
            <div>
              <dt>Platforms</dt>
              <dd>{view.platforms.length}</dd>
            </div>
            <div>
              <dt>In use</dt>
              <dd>
                {activeProviders} provider{activeProviders === 1 ? "" : "s"}
              </dd>
            </div>
            <div>
              <dt>Recorded spend</dt>
              <dd>{formatMicros(totalSpent)}</dd>
            </div>
          </dl>
        </section>

        <div className="providers-platforms">
          {view.platforms.map((platform) => {
            const cheapest = cheapestOf(platform);
            const headingId = `provider-platform-${platform.id}`;

            return (
              <section className="providers-platform" key={platform.id} aria-labelledby={headingId}>
                <header className="providers-platform-header">
                  <div>
                    <span className="providers-platform-icon" aria-hidden="true">
                      <BrandIcon brand={platform.id} size={24} />
                    </span>
                    <div>
                      <h2 id={headingId}>{platform.displayName}</h2>
                      <p>
                        {platform.comparable
                          ? `${platform.connectors.length} providers available — compare them side by side.`
                          : "One provider route is available for this platform."}
                      </p>
                    </div>
                  </div>
                  <span className="providers-count">
                    {platform.connectors.length} provider
                    {platform.connectors.length === 1 ? "" : "s"}
                  </span>
                </header>

                <div className="providers-table-scroll">
                  <table className="providers-table" role="table">
                    <thead role="rowgroup">
                      <tr role="row">
                        <th scope="col">Provider</th>
                        <th scope="col">Est. {view.comparedPosts} posts</th>
                        <th scope="col">Rate &amp; yield</th>
                        <th scope="col">Coverage</th>
                        <th scope="col">Spent so far</th>
                        <th scope="col">Posts &amp; freshness</th>
                        <th scope="col">Matches</th>
                      </tr>
                    </thead>
                    <tbody role="rowgroup">
                      {platform.connectors.map((connector) => (
                        <ProviderRow
                          key={connector.providerId}
                          connector={connector}
                          cheapest={cheapest}
                          comparedPosts={view.comparedPosts}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>

        <footer className="providers-footnotes">
          <div className="providers-spend-note">
            <div>
              <span>Total recorded spend</span>
              <strong>{formatMicros(totalSpent)}</strong>
            </div>
            <p>
              What this instance recorded across every provider, all time. It is our count of what
              you were charged, not a bill—check it against each provider's dashboard.
            </p>
          </div>

          <details className="disclosure providers-method">
            <summary>
              How to read these numbers <span>Method and caveats</span>
            </summary>
            <div>
              <p>
                <strong>A match is our guess. A verdict is yours.</strong> The classifier scores a
                post against your monitor, and a match only means it cleared the threshold. There{" "}
                {view.verdicts === 1 ? "is" : "are"} {view.verdicts === 0 ? "none" : view.verdicts}{" "}
                so far. Until there are more, “cost per match” means the cost of something worth
                reading, not the cost of a customer.
              </p>
              <p>
                A provider can show money spent and no posts. Older rows without provider
                attribution are left out rather than assigned to whichever provider is listed first.
              </p>
              <p>
                Match rate is only comparable <em>between two providers of one platform</em>. Across
                platforms it measures the monitor and its threshold instead. Anything under{" "}
                {view.thinSample} posts is marked as a thin sample.
              </p>
              <p>
                The estimate multiplies a provider's published price by the number of posts one unit
                brought back in a real run. Price and yield can change, and a different query can
                return a different amount. Where two yields were measured, the smaller is used so
                the estimate leans expensive.
              </p>
              <p>
                Amounts use four decimal places on purpose. Ten Reddit records cost $0.0150, and
                rounding that to cents would make the figure impossible to reconcile.
              </p>
            </div>
          </details>
        </footer>
      </div>
    </div>
  );
}
