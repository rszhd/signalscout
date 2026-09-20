/**
 * The monitor page's history: every poll, and every stage after it. US-266.
 *
 * The words and the arithmetic moved to `@signalscout/ui` with US-270, where
 * both applications read one copy of them. What is left here is the screen —
 * the list, its paging and the sentence about where the stage record ends —
 * because the two products show this differently and are free to.
 */

import {
  type ActivityEntry,
  activityGroupsOf,
  ageLabel,
  BrandIcon,
  messageFor,
  type PollRun,
  platformName,
  pollSummary,
  requestJson,
  type StageRun,
  stageLine,
  stopReasonLabel,
  useMonitorRefresh,
} from "@signalscout/ui";
import { useCallback, useEffect, useState } from "react";

/** One page of the history, as the API sends it. */
export interface ActivityPage {
  entries: ActivityEntry[];
  /** Where the stage record ends, or null when there is none. */
  stagesRecordedSince: string | null;
  more: boolean;
}

export const historyPageSize = 40;

/**
 * This monitor's recent activity: every poll, and every stage after it. US-266.
 *
 * One request and one list. The poll collected 72 posts, the filter kept 12,
 * the classifier matched 3, the notifier sent 1 — read as two lists those are
 * four separate questions, and three of them had no answer at all before the
 * pipeline wrote the rows.
 *
 * The page is opened to read exactly this, so it is fetched as the page loads
 * rather than behind a disclosure somebody has to find, and it re-reads on the
 * same clock the headline above it does. "Show older" asks for the next page,
 * before the oldest entry held.
 *
 * Notification deliveries are left out. They are not collection work, and a
 * line per digest between the polls and the scoring adds noise without saying
 * how a match reached the inbox.
 */
export function MonitorHistory({
  monitorId,
  working,
}: {
  readonly monitorId: string;
  readonly working: boolean;
}) {
  const [page, setPage] = useState<ActivityPage | null>(null);
  const [older, setOlder] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setPage(
        await requestJson<ActivityPage>(
          `/api/monitors/${monitorId}/activity?limit=${historyPageSize}`,
        ),
      );
      setError(null);
    } catch (cause: unknown) {
      setError(messageFor(cause, "The history could not be loaded."));
    }
  }, [monitorId]);

  useEffect(() => {
    setOlder([]);
    void load();
  }, [load]);

  useMonitorRefresh(load, working);

  const entries = [...(page?.entries ?? []), ...older];
  const oldest = entries[entries.length - 1];
  const lastPage = older.length > 0 ? older : (page?.entries ?? []);

  async function loadOlder(): Promise<void> {
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const next = await requestJson<ActivityPage>(
        `/api/monitors/${monitorId}/activity?limit=${historyPageSize}&before=${encodeURIComponent(oldest.at)}`,
      );
      setOlder((held) => [...held, ...next.entries]);
      setPage((held) => (held ? { ...held, more: next.more } : held));
    } catch (cause: unknown) {
      setError(messageFor(cause, "The older history could not be loaded."));
    } finally {
      setLoadingOlder(false);
    }
  }

  if (error) {
    return (
      <p className="budget-error" role="alert">
        {error}
      </p>
    );
  }

  if (!page) return <p className="monitor-origin">Loading…</p>;

  const history = entries.filter(
    (entry) => entry.kind !== "stage" || entry.stage.stage !== "notify",
  );

  if (history.length === 0) {
    return <p className="monitor-origin">Nothing has run yet.</p>;
  }

  const groups = activityGroupsOf(history);
  const since = page.stagesRecordedSince;
  // The stage record ends before the polls do when a poll older than the
  // oldest stage row is on screen: its stages ran, and they are gone.
  const stagesEnded = since !== null && lastPage.some((entry) => entry.at < since);

  return (
    <div className="poll-history">
      {groups.map((group) => (
        <div className="activity-collection" key={group.key}>
          {group.poll && (
            <ol className="activity-entries activity-poll-entries">
              <PollEntry run={group.poll.poll} />
            </ol>
          )}
          {group.stages.length > 0 && (
            <ol
              className={`activity-entries activity-stage-entries${group.poll ? " grouped" : ""}`}
              aria-label={
                group.poll ? "Processing after this poll" : "Processing with unknown poll"
              }
            >
              {group.stages.map((entry) => (
                <StageEntry key={entry.stage.id} at={entry.at} run={entry.stage} />
              ))}
            </ol>
          )}
        </div>
      ))}
      {stagesEnded && since && (
        <p className="monitor-origin activity-record-end">
          Stages are kept for a while and polls for longer. Polls before{" "}
          <time dateTime={since}>{new Date(since).toLocaleString()}</time> had stages too; those
          records are gone.
        </p>
      )}
      {page.more && (
        <button
          className="secondary-button"
          type="button"
          disabled={loadingOlder}
          onClick={() => void loadOlder()}
        >
          {loadingOlder ? "Loading…" : "Show older"}
        </button>
      )}
    </div>
  );
}

function StageEntry({ at, run }: { readonly at: string; readonly run: StageRun }) {
  return (
    <li className="activity-entry stage-entry">
      <time dateTime={at} title={new Date(at).toLocaleString()} className="poll-history-when">
        {ageLabel(at)}
      </time>
      <span className="poll-history-what">{stageLine(run)}</span>
    </li>
  );
}

function PollEntry({ run }: { readonly run: PollRun }) {
  return (
    <li className="activity-entry poll-entry">
      <time
        dateTime={run.startedAt}
        title={new Date(run.startedAt).toLocaleString()}
        className="poll-history-when"
      >
        {ageLabel(run.startedAt)}
      </time>
      {/* "this" poll: the reader is looking at the row. */}
      <span className="poll-history-what">{pollSummary(run, { subject: "this" })}</span>
      {/* Which platform did what, because a poll that skipped Reddit and
          collected X is one row and two different answers. */}
      <span className="poll-history-sources">
        {run.sources.map((entry) => (
          <span key={`${entry.source}-${entry.provider ?? "none"}`} className="brand-label">
            <BrandIcon brand={entry.source} size={14} />
            {platformName(entry.source)}: {entry.postsReturned} posts, {entry.postsNew} new
            {entry.reason ? ` — ${stopReasonLabel(entry.reason)}` : ""}
          </span>
        ))}
      </span>
    </li>
  );
}
