import { Link } from "react-router";
import { ageLabel } from "./labels.js";
import { MonitorStatus } from "./MonitorStatus.js";
import type { Monitoring } from "./monitor.js";

/**
 * What the monitoring is doing, above the matches. US-352.
 *
 * Three answers and no more: what is happening, when the next poll is if the
 * answer is "waiting", and what the last poll did. The history belongs on the
 * monitor page, which `monitorHref` opens: one monitor per project hosted, so
 * the page names the list; the monitor itself self-hosted.
 */
export interface MonitoringBarProps {
  readonly state: Monitoring;
  readonly monitorHref: string;
}

export function MonitoringBar({ state, monitorHref }: MonitoringBarProps) {
  return (
    <section className="inbox-monitoring" aria-label="Monitoring">
      <MonitorStatus label={state.label} tone={state.tone} attention={state.attention} />
      <p
        className="inbox-monitoring-now"
        title={state.nowAt ? new Date(state.nowAt).toLocaleString() : undefined}
      >
        {state.now}
      </p>
      {state.last && state.lastAt && (
        <p className="inbox-monitoring-last">
          <time dateTime={state.lastAt} title={new Date(state.lastAt).toLocaleString()}>
            {ageLabel(state.lastAt)}
          </time>
          {` · ${state.last}`}
        </p>
      )}
      <Link className="inbox-monitor-link" to={monitorHref}>
        View monitor
      </Link>
    </section>
  );
}
