/**
 * What a monitor is, and the words both monitor screens say about it. US-109.
 *
 * The list and the monitor page read the same response and must not disagree
 * about it. A status word computed twice becomes two status words the first
 * time somebody edits one of them, and "Found nothing" on one screen beside
 * "Running" on the other is the exact failure US-104 was written to end.
 *
 * Nothing here fetches or holds state except `PollHistory`, which is a
 * component because both screens show the same list of polls.
 */
import { useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";
import { BrandIcon } from "./BrandIcon.js";
import { ageLabel, platformName } from "./labels.js";

export interface Budget {
  monthlyCapMicros: number;
  onExhausted: "pause" | "notify";
}

export interface Spend {
  sourceMicros: number;
  modelMicros: number;
  totalMicros: number;
  remainingMicros: number | null;
  exhausted: boolean;
  reason: string | null;
  since: string;
}

export interface MissingCredential {
  environmentVariable: string;
}

export interface PreFilter {
  enabled: boolean;
  /**
   * Sent by the API and no longer edited here. It is a research dial: the
   * default of 0.15 came from one monitor and five posts, a value set too high
   * drops leads with no row and no bill to notice, and on every platform
   * measured so far the stage has dropped almost nothing — 0 of 40 posts on X,
   * 0 of 20 on LinkedIn, 1 of 50 in a subreddit. `PATCH /api/monitors/:id`
   * still carries it for whoever is tuning one.
   */
  similarityThreshold: number;
  dropped: { keyword: number; embedding: number; triage: number };
  /** Posts the classifier has read. With the drops it makes the total. */
  read: number;
}

/** The verdicts in force on this monitor's matches. US-012. */
export interface Feedback {
  good: number;
  notRelevant: number;
}

/** How many matches this monitor holds, and how many are unopened. US-109. */
export interface MatchCounts {
  total: number;
  unread: number;
}

/** Which provider last collected one platform for this monitor, and when. */
export interface LastCollection {
  source: string;
  provider: string;
  at: string;
}

/** One platform's line inside a poll. US-104. */
export interface PollRunSource {
  source: string;
  provider: string | null;
  pages: number;
  postsReturned: number;
  postsNew: number;
  units: number;
  estimatedCostMicros: number;
  reason: string | null;
}

/**
 * What one poll did. US-104.
 *
 * The three counts stay apart here as they do on the row: returned against
 * units says whether the searches found anything at all, and returned against
 * new says whether it was anything this instance had not already seen.
 */
export interface PollRun {
  id: string;
  walkId: string;
  startedAt: string;
  finishedAt: string;
  outcome: string;
  postsReturned: number;
  postsNew: number;
  units: number;
  estimatedCostMicros: number;
  stopReason: string | null;
  sources: PollRunSource[];
}

export interface Monitor {
  notificationIssues?: string[];
  id: string;
  name: string;
  /**
   * The project this monitor came out of. US-045.
   *
   * Optional as well as nullable, for the reason BUG-009 taught: a browser
   * holds a build for as long as its tab is open and talks to whatever API is
   * deployed, so a field this screen did not show yesterday can simply be
   * absent.
   */
  projectId?: string | null;
  projectName?: string | null;
  sources: string[];
  paused: boolean;
  lastPolledAt: string | null;
  /** When it runs. US-041. */
  pollIntervalSeconds: number;
  pollDays: number[];
  pollTimezone: string;
  lastCollected: LastCollection[];
  /**
   * The last poll, or null where none has run. US-104.
   *
   * Optional as well as nullable for `projectId`'s reason: a tab open since
   * before this shipped talks to the API that has it, and a tab open now may
   * talk to one that does not.
   */
  lastPoll?: PollRun | null;
  missingCredentials: MissingCredential[];
  budget: Budget | null;
  spend: Spend;
  preFilter: PreFilter;
  feedback: Feedback;
  /**
   * How many matches came out. US-109.
   *
   * Optional for the reason `lastPoll` is: a browser holding yesterday's build
   * asks an API that has it, and a browser holding today's may ask one that
   * does not.
   */
  matches?: MatchCounts;
}

/**
 * A micro-dollar amount as a person reads it.
 *
 * Up to four decimal places, and the server formats the same way for the
 * sentence it sends. Ten Reddit records cost $0.015, and a page that rounded
 * that to two cents could not be reconciled against an invoice.
 */
export function formatMicros(micros: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(micros / 1_000_000);
}

/** What a person typed in dollars, as the micro-dollars the API takes. */
export function toMicros(dollars: string): number | null {
  const amount = Number(dollars);
  if (!Number.isFinite(amount) || amount < 0) return null;

  return Math.round(amount * 1_000_000);
}

/** The month the figures cover, for the line above them. */
export function monthLabel(since: string): string {
  return new Date(since).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * What the person thought of this monitor's matches, in one sentence.
 *
 * PLAN.md sets the ratio as the real measure of success, so the sentence says
 * the ratio and not only the counts. A monitor nobody has judged says so
 * rather than showing two zeros, because "0 good" reads as a verdict about the
 * monitor and it is a verdict about nothing.
 */
export function feedbackLabel({ good, notRelevant }: Feedback): string {
  const judged = good + notRelevant;
  if (judged === 0) return "No matches judged yet";

  return `${good} good, ${notRelevant} not relevant of ${judged} judged`;
}

/**
 * What this monitor is doing, in two words.
 *
 * The budget comes before the pause, because a monitor the cap paused is
 * paused *for a reason a person needs*, and "Paused" alone would send them
 * looking for a button somebody pressed.
 */
export function status(monitor: Monitor): {
  label: string;
  tone: string;
  attention?: boolean;
} {
  if (monitor.spend.exhausted) return { label: "Budget spent", tone: "stopped" };
  if (monitor.missingCredentials.length > 0) return { label: "Needs a key", tone: "stopped" };
  if (monitor.paused) return { label: "Paused", tone: "paused" };

  /**
   * A monitor that is polling and finding nothing. US-104.
   *
   * The tone stays `running`, because it is: the filter above counts it among
   * the active monitors and it would be a lie to take it out of them. What
   * changes is the word and the badge, because on 2026-09-09 a monitor that
   * had spent $0.666 and collected nothing said `Running`, and the two
   * readings that leaves a person — nobody is talking, or this is broken — are
   * both wrong.
   */
  if (monitor.lastPoll?.outcome === "empty") {
    return { label: "Found nothing", tone: "running", attention: true };
  }

  if (monitor.lastPoll?.outcome === "failed") {
    return { label: "Poll failed", tone: "stopped" };
  }

  return { label: "Running", tone: "running" };
}

/** Whether this monitor is one of the ones a person has to do something about. */
export function needsAttention(monitor: Monitor): boolean {
  const state = status(monitor);

  return (
    state.tone === "stopped" ||
    // A poll that runs and finds nothing is the case US-104 exists for: it is
    // active, it may be spending, and nothing is arriving.
    state.attention === true ||
    (monitor.notificationIssues?.length ?? 0) > 0
  );
}

/**
 * Why a poll, or one platform inside it, stopped.
 *
 * The server sends the closed set from `schema.ts` and this is where each one
 * becomes a sentence. A screen that printed the value itself would show
 * somebody `no_provider_choice`.
 */
const stopReasonLabels: Record<string, string> = {
  budget_exhausted: "the monthly budget was spent",
  no_credentials: "no provider has a key",
  no_provider_choice: "no provider is chosen",
  not_offered: "this build no longer collects it",
  resume_key_missing: "the key that started the collection is gone",
  collection_abandoned: "the collection was never ready to read",
  provider_wait: "the provider asked us to come back",
  page_cap: "the page limit for one poll was reached",
  still_collecting: "a collection is still running",
  error: "the poll failed",
};

export function stopReasonLabel(reason: string | null): string | null {
  if (!reason) return null;

  return stopReasonLabels[reason] ?? reason;
}

/**
 * What the last poll did, in one line, without opening anything.
 *
 * The spend is on it whenever there was any, and that is the point rather than
 * a detail: a poll that found nothing and cost nothing is a quiet platform,
 * and a poll that found nothing and cost money is not. Only the two numbers
 * together say which.
 */
export function pollSummary(run: PollRun): string {
  const spent = run.units > 0 ? ` · ${formatMicros(run.estimatedCostMicros)} (estimated)` : "";
  const reason = stopReasonLabel(run.stopReason);

  if (run.outcome === "refused") {
    return `Last poll collected nothing: ${reason ?? "it was refused"}`;
  }

  if (run.outcome === "failed") {
    return `The last poll failed${spent}`;
  }

  if (run.outcome === "waiting") {
    return `Collecting: ${run.postsReturned} posts so far, ${run.postsNew} new${spent}`;
  }

  if (run.outcome === "empty") {
    const because = reason ? `, and ${reason}` : "";
    return `Last poll found no posts${because}${spent}`;
  }

  /**
   * A poll that collected *and* lost a platform. BUG-016.
   *
   * The outcome reads `collected` because it did collect, and making it say
   * otherwise would be the row lying about the posts it stored. So the failure
   * arrives here instead: without this clause a poll that lost X to a 503 and
   * kept Reddit reads as an ordinary success, which is the reading that let a
   * paid outage go unnoticed for a day.
   */
  const lost = run.sources.filter((entry) => entry.reason === "error");

  if (lost.length > 0) {
    const names = lost.map((entry) => platformName(entry.source)).join(", ");
    return `Last poll: ${run.postsReturned} posts, ${run.postsNew} new${spent} · ${names} failed`;
  }

  return `Last poll: ${run.postsReturned} posts, ${run.postsNew} new${spent}`;
}

/** When this monitor is due to try again, or null when nothing is scheduled. */
export function nextPollLabel(monitor: Monitor): string | null {
  if (monitor.paused || !monitor.lastPolledAt) return null;

  const due = new Date(monitor.lastPolledAt).getTime() + monitor.pollIntervalSeconds * 1000;

  return due <= Date.now() ? "due now" : `next ${new Date(due).toLocaleString()}`;
}

/**
 * This monitor's recent polls.
 *
 * The list screen no longer carries this at all: it shows one line per monitor
 * and links to the page, and the page is opened to read exactly this, so it is
 * fetched as the page loads rather than behind a disclosure somebody has to
 * find.
 */
export function PollHistory({ monitorId }: { readonly monitorId: string }) {
  const [runs, setRuns] = useState<PollRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    requestJson<PollRun[]>(`/api/monitors/${monitorId}/polls?limit=20`)
      .then((answer) => {
        if (live) setRuns(answer);
      })
      .catch((cause: unknown) => {
        if (live) setError(messageFor(cause, "The polls could not be loaded."));
      });

    return () => {
      live = false;
    };
  }, [monitorId]);

  if (error) {
    return (
      <p className="budget-error" role="alert">
        {error}
      </p>
    );
  }

  if (!runs) return <p className="monitor-origin">Loading…</p>;

  if (runs.length === 0) return <p className="monitor-origin">No polls recorded yet.</p>;

  return (
    <ul className="poll-history">
      {runs.map((run) => (
        <li key={run.id}>
          <time
            dateTime={run.startedAt}
            title={new Date(run.startedAt).toLocaleString()}
            className="poll-history-when"
          >
            {ageLabel(run.startedAt)}
          </time>
          <span className="poll-history-what">{pollSummary(run)}</span>
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
      ))}
    </ul>
  );
}
