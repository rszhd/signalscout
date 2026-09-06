import { useEffect, useRef, useState } from "react";
import { messageFor, requestJson } from "./api.js";
import { formatMicros } from "./Monitors.js";

/**
 * What a search plan would collect, and what it would cost, before it runs.
 *
 * US-014. On a metered source the money is spent at fetch time, so no filter
 * and no model can save a person from a query that is too broad. Only a
 * narrower query can, and nobody can narrow a query they have never seen run.
 *
 * The test costs money, which is the honest tension in this screen. So it runs
 * when a person presses the button and never on a keystroke, it samples ten
 * posts a query rather than a page, and it says what the answer itself cost.
 *
 * The answer does not arrive in the response. A Reddit sample is collected by
 * the provider over about two minutes, so the API answers with a run that is
 * still collecting and this polls until it is not.
 */

export interface EstimateSample {
  url: string;
  title: string | null;
  author: string | null;
  channel: string | null;
  excerpt: string;
  postedAt: string;
}

export interface ProbeReport {
  source: string;
  sourceName: string;
  kind: "query" | "channel";
  term: string;
  status: "collecting" | "ready" | "failed";
  /** Posts inside the window. What you would read. */
  postsFound: number;
  /** Records the source charged for. What you would pay. Not the same number. */
  unitsBilled: number;
  /** The source billed everything the sample asked for, so there was more. */
  capped: boolean;
  postsPerDay: number;
  monthlyUnitsLow: number;
  monthlyUnitsHigh: number;
  monthlyCostMicrosLow: number | null;
  monthlyCostMicrosHigh: number | null;
  billableUnit: string;
  overCap: boolean;
  samples: EstimateSample[];
  error: string | null;
}

export interface EstimateReport {
  id: string;
  monitorId: string | null;
  status: "collecting" | "ready" | "failed";
  pollIntervalSeconds: number;
  /** The days the quote assumed. US-041. */
  pollDays: number[];
  windowDays: number;
  testUnits: number;
  testCostMicros: number;
  queries: ProbeReport[];
  totals: {
    postsPerDay: number;
    monthlyUnitsLow: number;
    monthlyUnitsHigh: number;
    monthlyCostMicrosLow: number | null;
    monthlyCostMicrosHigh: number | null;
    capMicros: number | null;
    overCap: boolean;
  };
  error: string | null;
  finishedAt: string | null;
}

export interface CostTestProps {
  /** One list per platform, keyed by platform id. US-027. */
  queries: Record<string, string[]>;
  subreddits: string[];
  sources: string[];
  /** The cap the answer is measured against. Null when no cap was set. */
  monthlyCapMicros: number | null;
  /**
   * The schedule the person chose, which the projection multiplies by. US-041,
   * priced by BUG-005.
   *
   * Sent rather than left to the API's default, which is hourly and every day.
   * A weekly monitor quoted at hourly is 180 times too expensive, and the
   * schedule control sits on the same screen saying something else.
   */
  pollIntervalSeconds: number;
  pollDays: readonly number[];
  report: EstimateReport | null;
  onReport: (report: EstimateReport | null) => void;
}

/**
 * Is this more than the budget in the box allows?
 *
 * The screen compares against the cap a person has typed *now*, not the one
 * the run was measured against. Raising the budget after reading the answer is
 * arithmetic, and a screen that made them pay for a second test to see it
 * would be charging them for a subtraction.
 *
 * At the cap counts, because US-013's guard counts it: a monitor is exhausted
 * at `spend >= cap`, so a plan that lands exactly on its cap is one that stops
 * collecting before the month ends.
 */
export function exceedsCap(costMicros: number | null, capMicros: number | null): boolean {
  return costMicros !== null && capMicros !== null && costMicros >= capMicros;
}

/** How often the screen asks whether the samples are ready. */
const pollMilliseconds = 4000;

/**
 * How long to keep asking.
 *
 * The worker gives up on a sample after about ten minutes, so a screen that
 * waited longer would be waiting for an answer nobody is still writing.
 */
const pollLimit = 150;

/** A rate a person can read. Two posts a day, not 2.142857 posts a day. */
function perDay(rate: number): string {
  if (rate === 0) return "none";
  if (rate < 1) return `${rate.toFixed(1)} a day`;
  return `${Math.round(rate)} a day`;
}

/**
 * A month's cost, as a range when the sample could not narrow it.
 *
 * The two ends are the same number whenever the source had nothing more to
 * give, and then this reads as one figure. When they differ, the width is the
 * point: a sample of ten records billed for ten says only "there was more",
 * and a single figure invented from that would be a number nothing measured.
 */
function cost(low: number | null, high: number | null): string {
  if (low === null || high === null) return "no charge";
  if (low === high) return `${formatMicros(low)} a month`;

  return `${formatMicros(low)} to ${formatMicros(high)} a month`;
}

/** "every hour", from the interval the projection assumed. */
function intervalLabel(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours === 1 ? "every hour" : `every ${hours} hours`;
  }

  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "every minute" : `every ${minutes} minutes`;
}

/**
 * How the days read in the sentence under the table, or nothing.
 *
 * Silent on seven days, because "every hour, every day" is noise — the reader
 * only needs telling when the answer is narrower than they might assume, and
 * that is the case BUG-005 got wrong by pricing it as if it were not.
 */
function dayLabel(days: readonly number[]): string {
  if (days.length >= 7) return "";

  const weekdays = [1, 2, 3, 4, 5].join(",");
  const weekends = [0, 6].join(",");
  const chosen = [...days].sort((left, right) => left - right).join(",");

  if (chosen === weekdays) return ", on weekdays";
  if (chosen === weekends) return ", at weekends";

  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return `, on ${[...days]
    .sort((left, right) => left - right)
    .map((day) => names[day] ?? "?")
    .join(", ")}`;
}

export function CostTest({
  queries,
  subreddits,
  sources,
  monthlyCapMicros,
  pollIntervalSeconds,
  pollDays,
  report,
  onReport,
}: CostTestProps) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const polls = useRef(0);

  const collecting = report?.status === "collecting";

  /**
   * Ask again while the samples are still being collected.
   *
   * The effect is the only thing that repeats: the button starts one run, and
   * a run that is finished stops the timer by not scheduling another. Nothing
   * here spends money — the worker bought the samples, and this reads them.
   */
  useEffect(() => {
    if (!collecting || !report) return;

    if (polls.current >= pollLimit) {
      setError("The samples are taking longer than expected. Open the test again in a minute.");
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      polls.current += 1;

      requestJson<EstimateReport>(`/api/monitors/estimates/${report.id}`)
        .then((next) => {
          if (!cancelled) onReport(next);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(messageFor(cause, "The cost test could not be read."));
        });
    }, pollMilliseconds);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [collecting, report, onReport]);

  async function start(): Promise<void> {
    if (running || collecting) return;

    setError(null);
    setRunning(true);
    polls.current = 0;

    try {
      const started = await requestJson<EstimateReport>("/api/monitors/estimates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          queries,
          subreddits,
          sources,
          monthlyCapMicros,
          pollIntervalSeconds,
          pollDays: [...pollDays],
        }),
      });
      onReport(started);
    } catch (cause) {
      setError(messageFor(cause, "The cost test could not be started."));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="plan-section cost-section">
      <div className="section-title-row">
        <div>
          <h3>What this plan would cost</h3>
          <p>
            Runs each query once against a small sample. The sample is charged to your key, and the
            result says how much.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={running || collecting}
          type="button"
          onClick={start}
        >
          {running || collecting ? "Testing…" : report ? "Test again" : "Test this plan"}
        </button>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {collecting && (
        <p className="cost-waiting" role="status">
          <span className="spinner" aria-hidden="true" /> Collecting samples. Reddit takes about two
          minutes.
        </p>
      )}

      {report && report.status !== "collecting" && (
        <>
          {report.error && (
            <div className="notice warning" role="alert">
              <strong>The test did not finish.</strong>
              <span>{report.error}</span>
            </div>
          )}

          <table className="cost-table">
            <caption>
              Measured over the last {report.windowDays} days. The monthly figures assume this
              monitor polls {intervalLabel(report.pollIntervalSeconds)}
              {dayLabel(report.pollDays)}.
            </caption>
            <thead>
              <tr>
                <th scope="col">Query</th>
                <th scope="col">What it finds</th>
                <th scope="col">What it costs</th>
              </tr>
            </thead>
            <tbody>
              {report.queries.map((probe) => {
                const overCap = exceedsCap(probe.monthlyCostMicrosHigh, monthlyCapMicros);

                return (
                  <tr
                    className={overCap ? "over-cap" : undefined}
                    key={`${probe.source}-${probe.kind}-${probe.term}`}
                  >
                    <th scope="row">
                      {probe.kind === "channel" ? `r/${probe.term}` : probe.term}
                      <small>{probe.sourceName}</small>
                    </th>
                    <td>
                      {probe.status === "failed" ? (
                        <span className="cost-failed">{probe.error}</span>
                      ) : (
                        <>
                          {perDay(probe.postsPerDay)}
                          {probe.postsFound === 0 && probe.unitsBilled > 0 && (
                            <small>
                              nothing in the last {report.windowDays} days, and {probe.unitsBilled}{" "}
                              {probe.billableUnit}s were charged for anyway
                            </small>
                          )}
                          {probe.capped && probe.postsFound > 0 && (
                            <small>at least: the sample filled up at {probe.postsFound}</small>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      {probe.status === "failed" ? (
                        "—"
                      ) : (
                        <>
                          {cost(probe.monthlyCostMicrosLow, probe.monthlyCostMicrosHigh)}
                          {probe.monthlyCostMicrosLow !== null && (
                            <small>
                              {probe.monthlyUnitsLow.toLocaleString("en-US")}
                              {probe.monthlyUnitsHigh !== probe.monthlyUnitsLow &&
                                ` to ${probe.monthlyUnitsHigh.toLocaleString("en-US")}`}{" "}
                              {probe.billableUnit}s
                            </small>
                          )}
                          {overCap && <small className="over-cap-note">over your budget</small>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <dl className="cost-totals">
            <div>
              <dt>Estimated monthly cost</dt>
              <dd>
                {cost(report.totals.monthlyCostMicrosLow, report.totals.monthlyCostMicrosHigh)}
              </dd>
            </div>
            <div>
              <dt>Your monthly budget</dt>
              <dd>{monthlyCapMicros === null ? "no cap set" : formatMicros(monthlyCapMicros)}</dd>
            </div>
            <div>
              <dt>This test cost</dt>
              <dd>{formatMicros(report.testCostMicros)}</dd>
            </div>
          </dl>

          {exceedsCap(report.totals.monthlyCostMicrosHigh, monthlyCapMicros) && (
            <div className="notice warning" role="alert">
              <strong>This plan would spend its budget before the month ends.</strong>
              <span>
                Delete the queries marked above, widen the budget, or save the monitor without
                starting it.
              </span>
            </div>
          )}

          <p className="cost-caveat">
            Cost is counted from the records the source charged for, which is not the same as the
            posts you would read: a query can be billed for posts too old to keep. Every figure is
            an estimate, and your provider's invoice is the one that counts.
          </p>

          {report.queries.some((probe) => probe.samples.length > 0) && (
            <details className="cost-samples">
              <summary>Posts these queries found</summary>
              {report.queries.map((probe) =>
                probe.samples.map((sample) => (
                  <article key={sample.url}>
                    <a href={sample.url} rel="noreferrer noopener" target="_blank">
                      {sample.title ?? sample.url}
                    </a>
                    <p>{sample.excerpt}</p>
                    <small>
                      {probe.kind === "channel" ? `r/${probe.term}` : probe.term}
                      {sample.channel ? ` · r/${sample.channel}` : ""}
                    </small>
                  </article>
                )),
              )}
            </details>
          )}
        </>
      )}
    </section>
  );
}
