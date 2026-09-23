// biome-ignore-all lint/a11y/noRedundantRoles: the roles are not redundant at phone width, where the stylesheet gives every table element `display: block` and the implicit table semantics go with it.
import { useState } from "react";
import { BrandIcon } from "./BrandIcon.js";
import { Button } from "./components/Button.js";
import { platformName } from "./labels.js";
import {
  defaultLeadDimensions,
  type LeadBreakdown,
  type LeadDimension,
  leadDimensionWords,
  leadGroupName,
} from "./monitor-stats.js";

/**
 * Where a monitor's matches come from, one comparison at a time. US-353.
 *
 * A switch over one table rather than a table per group: the columns stay in
 * one place and a person changes only what they compare. The page fetches the
 * breakdown and passes it in; `null` is still loading. `dimensions` names the
 * groups offered, in order; the only state here is which one is shown.
 */
export interface LeadSourcesProps {
  readonly breakdown: LeadBreakdown | null;
  readonly error?: string | null;
  readonly onRetry: () => void;
  readonly dimensions?: readonly LeadDimension[];
}

export function LeadSources({
  breakdown,
  error = null,
  onRetry,
  dimensions = defaultLeadDimensions,
}: LeadSourcesProps) {
  const [chosen, setChosen] = useState<LeadDimension>(dimensions[0] ?? "platforms");
  const dimension = dimensions.includes(chosen) ? chosen : (dimensions[0] ?? "platforms");
  const words = leadDimensionWords[dimension];
  const rows = breakdown?.[dimension] ?? [];
  const hasMatches = breakdown !== null && dimensions.some((item) => breakdown[item].length > 0);

  return (
    <div className="lead-sources">
      <p className="lead-sources-note">
        Compare where matches come from and how well they score. Strong leads score 70 or higher.
      </p>

      {error ? (
        <div className="query-performance-error" role="alert">
          <p>{error}</p>
          <Button variant="compact" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : breakdown === null ? (
        <p className="monitor-origin">Reading lead sources.</p>
      ) : !hasMatches ? (
        <div className="lead-sources-empty">
          <h3>No matches yet</h3>
          <p>This breakdown will fill in as the monitor finds leads.</p>
        </div>
      ) : (
        <>
          <fieldset className="view-switch lead-breakdown-switch">
            <legend className="visually-hidden">Lead breakdown</legend>
            {dimensions.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={dimension === item}
                onClick={() => setChosen(item)}
              >
                {leadDimensionWords[item].label}
              </button>
            ))}
          </fieldset>

          {rows.length === 0 ? (
            <p className="lead-breakdown-empty">{words.empty}</p>
          ) : (
            <div className="lead-performance-table-scroll">
              <table className="lead-performance-table" role="table">
                <thead role="rowgroup">
                  <tr role="row">
                    <th scope="col" role="columnheader">
                      {words.itemLabel}
                    </th>
                    <th scope="col" role="columnheader">
                      Matches
                    </th>
                    <th scope="col" role="columnheader">
                      Average
                    </th>
                    <th scope="col" role="columnheader">
                      Best
                    </th>
                    <th scope="col" role="columnheader">
                      Strong 70+
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {rows.map((row) => {
                    const source =
                      dimension === "platforms"
                        ? row.value
                        : dimension === "channels"
                          ? row.source
                          : null;
                    return (
                      <tr role="row" key={`${row.source ?? "all"}:${row.value}`}>
                        <th scope="row" role="rowheader">
                          <span className="lead-source-name">
                            {source ? <BrandIcon brand={source} size={16} /> : null}
                            {leadGroupName(dimension, row)}
                          </span>
                          {dimension === "channels" && row.source ? (
                            <small className="lead-source-platform">
                              {platformName(row.source)}
                            </small>
                          ) : null}
                        </th>
                        <td role="cell" data-label="Matches">
                          {row.matches.toLocaleString()}
                        </td>
                        <td role="cell" data-label="Average">
                          {row.averageScore} / 100
                        </td>
                        <td role="cell" data-label="Best">
                          {row.bestScore} / 100
                        </td>
                        <td role="cell" data-label="Strong 70+">
                          {row.strong.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
