/**
 * The monitor page's history: every poll, and every stage after it. US-266.
 *
 * The list is `MonitorHistory` in `@signalscout/ui` (US-353). What is left here
 * is this API's half: the request, its paging, and where the stage record
 * ends, which the hosted API does not send.
 */

import {
  type ActivityEntry,
  MonitorHistory,
  messageFor,
  requestJson,
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
export function MonitorActivity({
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

  return (
    <MonitorHistory
      entries={page ? entries : null}
      error={error}
      stagesRecordedSince={page?.stagesRecordedSince ?? null}
      more={page?.more ?? false}
      loadingOlder={loadingOlder}
      onShowOlder={() => void loadOlder()}
    />
  );
}
