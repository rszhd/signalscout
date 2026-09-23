// biome-ignore-all lint/a11y/noRedundantRoles: the roles are not redundant at phone width, where the stylesheet gives every table element `display: block` and the implicit table semantics go with it.
import { Button } from "./components/Button.js";
import { ageLabel } from "./labels.js";
import type { Monitor } from "./monitor.js";
import { inputKey, type QueryPerformanceRow, searchInputs } from "./monitor-stats.js";

/**
 * What each search input finds: posts, matches, best score, last found.
 * US-353.
 *
 * Every configured input is a row, including one with no results yet, so a
 * phrase that finds nothing is visible. The page fetches the rows and passes
 * them in; `null` is still loading. The heading around the table is the
 * page's: a tab hosted, a titled section self-hosted.
 *
 * `note` adds a word about a row after its kind, in the warning colour:
 * self-hosted it is "Never matched" or "No match in 30 days".
 */
export interface QueryPerformanceProps {
  readonly monitor: Monitor;
  readonly rows: readonly QueryPerformanceRow[] | null;
  readonly error?: string | null;
  readonly onRetry: () => void;
  readonly note?: (row: QueryPerformanceRow | undefined) => string | null;
}

export function QueryPerformance({
  monitor,
  rows,
  error = null,
  onRetry,
  note,
}: QueryPerformanceProps) {
  const configured = searchInputs(monitor);
  const byInput = new Map((rows ?? []).map((row) => [inputKey(row), row]));
  const inputs = configured.length > 0 ? configured : (rows ?? []);

  return (
    <div className="query-performance">
      <p className="query-performance-note">
        Only posts collected since query tracking began appear here. Earlier posts cannot be
        assigned to a search input.
      </p>

      {error ? (
        <div className="query-performance-error" role="alert">
          <p>{error}</p>
          <Button variant="compact" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : rows === null ? (
        <p className="monitor-origin">Reading search performance.</p>
      ) : inputs.length === 0 ? (
        <p className="monitor-origin">No search inputs are configured.</p>
      ) : (
        <div className="query-performance-table-scroll">
          <table className="query-performance-table" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">
                  Search input
                </th>
                <th scope="col" role="columnheader">
                  Posts
                </th>
                <th scope="col" role="columnheader">
                  Matches
                </th>
                <th scope="col" role="columnheader">
                  Best score
                </th>
                <th scope="col" role="columnheader">
                  Last found
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {inputs.map((input) => {
                const row = byInput.get(inputKey(input));
                const said = note?.(row) ?? null;
                return (
                  <tr role="row" key={inputKey(input)}>
                    <th scope="row" role="rowheader">
                      <span className="query-performance-value">
                        {input.kind === "channel" ? `r/${input.value}` : input.value}
                      </span>
                      <small className="query-performance-kind">
                        {input.kind === "channel" ? "Subreddit" : "Search query"}
                        {!row ? " · Nothing found yet" : ""}
                        {said && (
                          <>
                            {" · "}
                            <span className="query-performance-verdict">{said}</span>
                          </>
                        )}
                      </small>
                    </th>
                    <td role="cell" data-label="Posts">
                      {row ? row.posts.toLocaleString() : "—"}
                    </td>
                    <td role="cell" data-label="Matches">
                      {row ? row.matches.toLocaleString() : "—"}
                    </td>
                    <td
                      role="cell"
                      data-label="Best score"
                      className={row?.bestScore === null ? "query-performance-empty" : undefined}
                    >
                      {row
                        ? row.bestScore === null
                          ? "No match yet"
                          : `${row.bestScore} / 100`
                        : "—"}
                    </td>
                    <td role="cell" data-label="Last found">
                      {row?.lastFoundAt ? (
                        <time
                          dateTime={row.lastFoundAt}
                          title={new Date(row.lastFoundAt).toLocaleString()}
                        >
                          {ageLabel(row.lastFoundAt)}
                        </time>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
