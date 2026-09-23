import { BrandIcon } from "./BrandIcon.js";
import { ageLabel, platformName } from "./labels.js";
import {
  type ActivityEntry,
  activityGroupsOf,
  type PollRun,
  type PollSentence,
  pollSummary,
  type StageRun,
  stageLine,
  stopReasonLabel,
} from "./monitor.js";

/**
 * A monitor's activity: every poll, and every stage after it. US-353.
 *
 * The page fetches, because the two APIs answer in different shapes, and
 * passes the entries in; `null` is still loading. Paging is optional: a page
 * that pages passes `more` and `onShowOlder`, and `stagesRecordedSince` when
 * the stage record ends before the polls do.
 *
 * Notification deliveries are left out: they are not collection work, and a
 * line per digest between the polls says nothing about how a match arrived.
 */
export interface MonitorHistoryProps {
  readonly entries: readonly ActivityEntry[] | null;
  readonly error?: string | null;
  /** Where the stage record ends, or null when it does not. */
  readonly stagesRecordedSince?: string | null;
  readonly more?: boolean;
  readonly loadingOlder?: boolean;
  readonly onShowOlder?: () => void;
  /** Passed to `pollSummary`: `{ spend: false }` hosted. */
  readonly sentence?: PollSentence;
}

export function MonitorHistory({
  entries,
  error = null,
  stagesRecordedSince = null,
  more = false,
  loadingOlder = false,
  onShowOlder,
  sentence = {},
}: MonitorHistoryProps) {
  if (error) {
    return (
      <p className="budget-error" role="alert">
        {error}
      </p>
    );
  }

  if (!entries) return <p className="monitor-origin">Loading…</p>;

  const history = entries.filter(
    (entry) => entry.kind !== "stage" || entry.stage.stage !== "notify",
  );

  if (history.length === 0) return <p className="monitor-origin">Nothing has run yet.</p>;

  const since = stagesRecordedSince;
  // A poll older than the oldest stage row is on screen: its stages ran, and
  // their records are gone.
  const stagesEnded = since !== null && entries.some((entry) => entry.at < since);

  return (
    <div className="poll-history">
      {activityGroupsOf(history).map((group) => (
        <div className="activity-collection" key={group.key}>
          {group.poll && (
            <ol className="activity-entries activity-poll-entries">
              <PollEntry run={group.poll.poll} sentence={sentence} />
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
      {more && onShowOlder && (
        <button
          className="secondary-button"
          type="button"
          disabled={loadingOlder}
          onClick={onShowOlder}
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

function PollEntry({ run, sentence }: { readonly run: PollRun; readonly sentence: PollSentence }) {
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
      <span className="poll-history-what">
        {pollSummary(run, { ...sentence, subject: "this" })}
      </span>
      {/* Which platform did what: a poll that skipped Reddit and collected X
          is one row and two different answers. */}
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
