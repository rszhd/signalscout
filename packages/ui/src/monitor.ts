/**
 * What a monitor is, and the words both applications say about it. US-270.
 *
 * Two screens read the same response and must not disagree about it. A status
 * word computed twice becomes two status words the first time somebody edits
 * one of them, and "Found nothing" on one screen beside "Running" on another
 * is the exact failure US-104 was written to end. The two applications are
 * the same failure one repository wider: these words were written twice and
 * ported by hand once.
 *
 * Words and arithmetic only. Nothing here fetches, renders or holds state
 * except `useMonitorRefresh`, which is the one rule about *how often* a
 * screen re-reads and belongs with the rule about what it says.
 *
 * Where the two applications differ, the difference is an argument rather
 * than a fork: `pollSummary` takes `spend`, because the hosted product shows
 * a share of an allowance and never a dollar, and `Monitor.pausedByPlan`
 * exists for the plan that paused it there and is absent here.
 */
import { useEffect } from "react";
import { platformName, untilLabel } from "./labels.js";

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
  dropped: { keyword: number; embedding: number; triage: number; ceiling: number };
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

/**
 * A stage of the work in flight for a monitor, read off the queue. US-265.
 *
 * The poll is the first of five, and the short one. The filter, the threads,
 * the classifier and the notifier are the minutes after it that a person
 * waits through with the inbox open.
 */
export interface Stage {
  /** The queue's own name. `stageLabel` is where it becomes a sentence. */
  queue: string;
  /** `active` is a worker holding it; `queued` is one about to. */
  state: "active" | "queued";
  since: string;
  /** Posts or matches the job holds, or null on a poll, which holds none. */
  items: number | null;
  /** The collection it belongs to, or null. */
  walkId?: string | null;
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
  /**
   * The search plan, as the API holds it: phrases per platform and the
   * subreddits browsed. US-267 reads it so an input that has never returned
   * a post is still on the screen. Optional for `lastPoll`'s reason.
   */
  queries?: Record<string, string[]>;
  subreddits?: string[];
  paused: boolean;
  /**
   * Why a plan paused it, or null. The hosted product's field (US-167 there).
   *
   * Absent in the self-hosted application, which charges nobody and has no
   * plan to pause a monitor. It is here rather than forked because
   * `monitoringState` has to say *who* paused a monitor, and "Paused" alone
   * sends a person looking for a button somebody pressed.
   */
  pausedByPlan?: string | null;
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
  /**
   * What the worker holds for this monitor now, or null. US-265.
   *
   * Optional for `lastPoll`'s reason, and read through `stageOf`, which is the
   * one place that decides whether what an API sent is a stage.
   */
  stage?: Stage | null;
  missingCredentials: MissingCredential[];
  budget: Budget | null;
  spend: Spend;
  preFilter: PreFilter;
  /**
   * The score a post must reach to become a match. US-264.
   *
   * Optional for `lastPoll`'s reason: an older API does not send it. The
   * package's default is 30, and US-223 says why it stays there.
   */
  minScore?: number;
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
 * Which poll a sentence is about. US-266.
 *
 * `last` is the one poll that is the last: the current-activity line and the
 * list's column mean it. `this` describes a row in a history, where every row
 * saying "Last poll" was a claim only the top one could make.
 */
export type PollSubject = "last" | "this";

/**
 * How one application says a poll. US-270.
 *
 * `spend` is the difference between the two products rather than a
 * preference. Self-hosted, the money is the person's own and a poll that
 * found nothing and cost nothing is a quiet platform while one that found
 * nothing and cost money is not — so the amount is the point. Hosted, a
 * subscriber sees a share of an allowance and never a dollar (US-173 there),
 * and a figure in dollars answers a question nobody asked.
 */
export interface PollSentence {
  readonly subject?: PollSubject;
  readonly spend?: boolean;
}

/**
 * What one poll did, in one line, without opening anything.
 *
 * The spend is on it whenever there was any, and that is the point rather than
 * a detail: a poll that found nothing and cost nothing is a quiet platform,
 * and a poll that found nothing and cost money is not. Only the two numbers
 * together say which.
 *
 * The subject defaults to `last` because three of the four callers mean it,
 * and the fourth — the history — is the one that names its own.
 */
export function pollSummary(run: PollRun, sentence: PollSentence = {}): string {
  const { subject = "last", spend = true } = sentence;
  const spent =
    spend && run.units > 0 ? ` · ${formatMicros(run.estimatedCostMicros)} (estimated)` : "";
  const reason = stopReasonLabel(run.stopReason);
  const which = subject === "this" ? "This poll" : "Last poll";

  if (run.outcome === "refused") {
    return `${which} collected nothing: ${reason ?? "it was refused"}`;
  }

  if (run.outcome === "failed") {
    return `${subject === "this" ? "This poll" : "The last poll"} failed${spent}`;
  }

  if (run.outcome === "waiting") {
    return `Collecting: ${run.postsReturned} posts so far, ${run.postsNew} new${spent}`;
  }

  if (run.outcome === "empty") {
    const because = reason ? `, and ${reason}` : "";
    return `${which} found no posts${because}${spent}`;
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
    return `${which}: ${run.postsReturned} posts, ${run.postsNew} new${spent} · ${names} failed`;
  }

  return `${which}: ${run.postsReturned} posts, ${run.postsNew} new${spent}`;
}

/**
 * When this monitor is next due, as an instant, or null when nothing is
 * scheduled. The label below and the monitoring bar both read it.
 */
export function nextPollAt(monitor: Monitor): string | null {
  if (monitor.paused || !monitor.lastPolledAt) return null;

  return new Date(
    new Date(monitor.lastPolledAt).getTime() + monitor.pollIntervalSeconds * 1000,
  ).toISOString();
}

/** When this monitor is due to try again, or null when nothing is scheduled. */
export function nextPollLabel(monitor: Monitor, now: number = Date.now()): string | null {
  const due = nextPollAt(monitor);
  if (!due) return null;

  return new Date(due).getTime() <= now ? "due now" : `next ${new Date(due).toLocaleString()}`;
}

/**
 * What the monitoring behind a screen is doing, in the words both monitor
 * screens already use. US-265.
 *
 * The inbox is the screen a person keeps open and the only one that said
 * nothing about collection, so an empty list read as "nobody is talking" and
 * as "this has been paused for a week" at the same time. This is the answer,
 * and it is derived here rather than in the inbox for the reason at the top of
 * this file: a status computed twice becomes two statuses.
 *
 * One monitor speaks for the list it is given. The one a person would want to
 * be told about: a monitor that needs attention before one that is working,
 * work in flight before a schedule being waited on, and the soonest poll
 * before a later one.
 */
export interface Monitoring {
  /** The monitor the bar speaks for. */
  monitor: Monitor;
  /** Its status, in the two words the monitor screens use. */
  label: string;
  tone: string;
  attention: boolean;
  /** What is happening now, or what is being waited for. Never empty. */
  now: string;
  /** The instant behind `now`, for a `title`. Null when there is none. */
  nowAt: string | null;
  /** The last finished poll in one line, or null when none has finished. */
  last: string | null;
  lastAt: string | null;
  /**
   * Whether work is in flight, rather than a schedule being waited on.
   *
   * A screen reads it to ask more often while something is happening: a
   * classification pass is over in minutes, and a bar refreshed once a minute
   * would report most of it after it ended.
   */
  working: boolean;
}

/** Whether a poll is running right now. US-104 calls that outcome `waiting`. */
function collecting(monitor: Monitor): boolean {
  return monitor.lastPoll?.outcome === "waiting";
}

/** `12 posts`, `1 post`, or `posts` where the job carries no count. */
function countOf(items: number | null, noun: string): string {
  if (items === null) return `${noun}s`;

  return `${items} ${noun}${items === 1 ? "" : "s"}`;
}

/**
 * What each stage is called, running and waiting to run.
 *
 * A sentence per queue, for the reason `stopReasonLabel` above has one per
 * code: a screen that printed the value would show somebody `classify`. The
 * words say what is being done to what, because "Classifying" alone reads as a
 * state of the monitor and it is work on a known number of posts.
 *
 * `filter` names the triage as well as the filtering. They are one queue and
 * two stages — keywords and embeddings drop for free, then a cheap model reads
 * what survived — and the model call is the part slow enough to be worth
 * naming.
 */
const stageWords: Record<string, (items: number | null) => { active: string; queued: string }> = {
  poll: () => ({
    active: "Collecting posts",
    queued: "Queued to collect posts",
  }),
  filter: (items) => ({
    active: `Filtering and triaging ${countOf(items, "post")}`,
    queued: `Queued to filter ${countOf(items, "post")}`,
  }),
  replies: (items) => ({
    active: `Reading comment threads under ${countOf(items, "post")}`,
    queued: `Queued to read threads under ${countOf(items, "post")}`,
  }),
  classify: (items) => ({
    active: `Scoring ${countOf(items, "post")}`,
    queued: `Queued to score ${countOf(items, "post")}`,
  }),
  notify: (items) => ({
    active: `Sending ${countOf(items, "notification")}`,
    queued: `Queued to send ${countOf(items, "notification")}`,
  }),
};

/**
 * One stage, as a person reads it.
 *
 * A queue this build has no words for — a worker newer than this bundle — is
 * said plainly rather than printed as its own name. The stage is still true;
 * only its sentence is missing.
 */
export function stageLabel(stage: Stage): string {
  const words = stageWords[stage.queue]?.(stage.items);

  if (!words) return stage.state === "active" ? "Working" : "Queued";

  return stage.state === "active" ? words.active : words.queued;
}

/**
 * The stage in flight for this monitor, or null.
 *
 * The one place that decides whether a `stage` field is a stage: a browser
 * talking to an API older than the field gets null, not a crash.
 */
export function stageOf(monitor: Monitor): Stage | null {
  const stage = monitor.stage;

  if (!stage || typeof stage.queue !== "string" || !stage.since) return null;

  return stage;
}

export function monitoringState(
  monitors: readonly Monitor[],
  now: number = Date.now(),
  /** How this application says a poll. US-270. */
  sentence: PollSentence = {},
): Monitoring | null {
  /**
   * Rows this build can read a status out of.
   *
   * `status` reads the spend and the credentials without asking whether they
   * are there, which is right on a screen that is loaded with the row. Here it
   * is not: a tab open across a deployment talks to whichever API answers, and
   * BUG-008 is what a missing field costs on the inbox — the screen itself
   * disappears. A row the bar cannot read is a row it says nothing about.
   */
  const readable = monitors.filter(
    (monitor) => monitor?.spend != null && Array.isArray(monitor.missingCredentials),
  );

  if (readable.length === 0) return null;

  const due = (monitor: Monitor): number => {
    const at = nextPollAt(monitor);
    return at ? new Date(at).getTime() : Number.POSITIVE_INFINITY;
  };

  const speaker =
    readable.find((monitor) => needsAttention(monitor)) ??
    // Work in flight before a schedule being waited on: one of them is
    // happening and the other is not.
    readable.find((monitor) => stageOf(monitor)?.state === "active") ??
    readable.find((monitor) => collecting(monitor)) ??
    readable.find((monitor) => stageOf(monitor) !== null) ??
    [...readable].sort((left, right) => due(left) - due(right))[0];

  // `readable` is not empty, so this cannot happen. The compiler cannot see
  // that through an index, and a cast here would be the one place this file
  // stops being checked.
  if (!speaker) return null;

  const state = status(speaker);
  const run = speaker.lastPoll ?? null;
  const nextAt = nextPollAt(speaker);
  const stage = stageOf(speaker);

  // A poll in flight is the whole answer: it is what is happening now, and the
  // run it would otherwise be reported as is the same run. Saying both would
  // print one poll twice. It comes before the stage below because the run says
  // more than the queue row does — the posts it has collected so far.
  if (run && collecting(speaker)) {
    return {
      monitor: speaker,
      label: state.label,
      tone: state.tone,
      attention: state.attention === true,
      now: pollSummary(run, sentence),
      nowAt: run.startedAt,
      last: null,
      lastAt: null,
      working: true,
    };
  }

  /**
   * A stage of the work, which is what fills the inbox after a poll.
   *
   * It beats the schedule below, because the schedule is what a person is told
   * when nothing is happening, and something is. The last poll stays beside it:
   * "Scoring 12 posts" and "Last poll: 72 posts, 12 new" are two facts, and
   * together they say where those twelve came from.
   */
  if (stage) {
    return {
      monitor: speaker,
      label: state.label,
      tone: state.tone,
      attention: state.attention === true,
      now: stageLabel(stage),
      nowAt: stage.since,
      last: run ? pollSummary(run, sentence) : null,
      lastAt: run ? run.startedAt : (speaker.lastPolledAt ?? null),
      working: stage.state === "active",
    };
  }

  const waiting = speaker.pausedByPlan
    ? speaker.pausedByPlan
    : speaker.paused
      ? "Paused — nothing is collected until it is resumed"
      : speaker.spend.exhausted
        ? "No more polls this month"
        : nextAt
          ? `Next poll ${untilLabel(nextAt, now)}`
          : "Waiting for the first poll";

  return {
    monitor: speaker,
    label: state.label,
    tone: state.tone,
    attention: state.attention === true,
    now: waiting,
    nowAt: speaker.paused || speaker.spend.exhausted ? null : nextAt,
    last: run ? pollSummary(run, sentence) : null,
    lastAt: run ? run.startedAt : (speaker.lastPolledAt ?? null),
    working: false,
  };
}

/**
 * How often a screen re-reads its monitors. US-265.
 *
 * Two periods, because the two questions have different clocks. Waiting for a
 * schedule is measured in hours, so a minute is early enough. A stage is
 * measured in minutes — a triage is over in seconds — so a screen on the
 * minute would report most of a stage after it had ended.
 *
 * Both are one `GET /api/monitors`: no provider, no model, no money.
 */
export const idleRefreshMs = 60_000;
export const workingRefreshMs = 15_000;

/**
 * Re-read on a timer, faster while the worker is busy. US-265.
 *
 * One hook for the inbox, the monitor list and the monitor page. The rule is
 * written once, because a second and third copy of it is how three screens
 * end up with three answers about how live they are.
 *
 * Nothing is asked while the tab is hidden: a laptop left open for a week
 * would otherwise send thousands of requests about a screen nobody is looking
 * at. Coming back to the tab asks once, immediately, because the first thing a
 * person does on returning is read it.
 */
export function useMonitorRefresh(reload: () => void | Promise<void>, working: boolean): void {
  useEffect(() => {
    const ask = (): void => {
      if (document.visibilityState === "visible") void reload();
    };

    const timer = window.setInterval(ask, working ? workingRefreshMs : idleRefreshMs);

    document.addEventListener("visibilitychange", ask);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [reload, working]);
}

/**
 * Whether any of these monitors has work running. US-265.
 *
 * A queued stage is not work in flight. It is about to be, and the screen says
 * so, but it must not make the browser ask four times a minute for a worker
 * that has not picked it up.
 */
export function anyWorking(monitors: readonly Monitor[]): boolean {
  return monitors.some((monitor) => stageOf(monitor)?.state === "active");
}

/**
 * One finished run of a stage after the poll. US-266, from US-201's table.
 *
 * `Stage` above is the live one, read off the queue: what is happening now.
 * This is the record of one that ended, with what it produced — which the
 * queue row never held.
 */
export type StageRunDetail =
  | { stage: "filter"; keyword: number; embedding: number; triage: number }
  | { stage: "replies"; threadsOpened: number; threadsSkipped: number; pagesBought: number }
  | {
      stage: "classify";
      /** What the model answered for in this run. US-206. */
      scored: number;
      /**
       * Already scored, so not asked again — BUG-003's skip. Optional: a row
       * written before US-206 counted the skipped posts as scored and has no
       * number for this.
       */
      skipped?: number;
      matched: number;
      unclassified: number;
      dropped: number;
      leftByCap: number;
    }
  | { stage: "notify"; deliveries: number };

export interface StageRun {
  id: string;
  stage: string;
  /** The collection this stage was part of, or null. US-203. */
  walkId: string | null;
  /** The exact poll whose posts this stage processed, or null for older rows. US-211. */
  pollRunId: string | null;
  startedAt: string;
  finishedAt: string;
  outcome: string;
  itemsIn: number;
  itemsOut: number;
  units: number;
  estimatedCostMicros: number;
  detail: StageRunDetail | null;
  stopReason: string | null;
}

/** One line of the history: a poll, or a stage that ran after one. */
export type ActivityEntry =
  | { kind: "poll"; at: string; poll: PollRun }
  | { kind: "stage"; at: string; stage: StageRun };

/** Why a stage refused, in the words the rest of the screen uses. */
const stageRefusals: Record<string, string> = {
  budget_exhausted: "the monthly budget was spent",
  no_model: "no model is configured",
  no_credentials: "no provider has a key",
  error: "it failed",
};

/**
 * `3 posts`, `1 post`, `2 replies`. The history counts things in nearly every
 * sentence, and one of the nouns does not take a plain `s`.
 */
function count(items: number, noun: string, plural = `${noun}s`): string {
  return `${items} ${items === 1 ? noun : plural}`;
}

/**
 * What one finished stage did, in one line.
 *
 * The verbs are past tense and the live bar's are present, deliberately: this
 * list is read beside a headline that says "Scoring 12 posts", and two
 * sentences that look the same for a stage that has ended and one that is
 * running would be the failure US-104 named — a person cannot tell which
 * half of the screen is about now.
 *
 * The drop words are the ones `countsSentence` uses on this same page, so the
 * pre-filter is explained once and in one voice.
 */
export function stageDidLabel(run: StageRun): string {
  const why = run.stopReason ? stageRefusals[run.stopReason] : null;
  const detail = run.detail;

  /**
   * A run that produced nothing at all.
   *
   * `failed` is only this when there is no detail to read. A classification
   * that scored ninety posts and could not score the last twenty-seven ends
   * `failed` — the job throws so the queue retries it — and a line that said
   * "Scored nothing of 117 posts: it failed" over a run that had just written
   * twenty-seven matches would be wrong. What it did comes first, and the
   * failure is said at the end, where it belongs.
   */
  if (run.outcome === "refused" || (run.outcome === "failed" && !detail)) {
    const what =
      run.stage === "classify"
        ? `Scored nothing of ${count(run.itemsIn, "post")}`
        : run.stage === "replies"
          ? "Read no thread"
          : run.stage === "notify"
            ? `Sent none of ${count(run.itemsIn, "notification")}`
            : `Filtered nothing of ${count(run.itemsIn, "post")}`;

    return why ? `${what}: ${why}` : what;
  }

  if (detail?.stage === "filter") {
    const were = (items: number) => (items === 1 ? "was" : "were");

    const dropped = [
      detail.keyword > 0 ? `${detail.keyword} did not use your words` : null,
      detail.embedding > 0
        ? `${detail.embedding} ${were(detail.embedding)} not about your subject`
        : null,
      detail.triage > 0 ? `${detail.triage} read as someone answering` : null,
    ].filter((part): part is string => part !== null);

    const kept = `Filtered ${count(run.itemsIn, "post")} — ${run.itemsOut} kept`;

    return dropped.length > 0 ? `${kept}, ${dropped.join(", ")}` : kept;
  }

  if (detail?.stage === "replies") {
    if (detail.threadsOpened === 0) {
      return `Opened no thread of ${count(run.itemsIn, "post")}: none had grown`;
    }

    return `Read ${count(detail.threadsOpened, "thread")} — ${count(run.itemsOut, "reply", "replies")} stored, ${count(detail.pagesBought, "page")} bought`;
  }

  if (detail?.stage === "classify") {
    const skipped = detail.skipped ?? 0;

    const extra = [
      // First, because it is what explains the two numbers above it. US-206:
      // a retry is handed the whole batch and asks about almost none of it.
      skipped > 0 ? `${skipped} already scored` : null,
      detail.unclassified > 0 ? `${detail.unclassified} left unclassified` : null,
      detail.dropped > 0 ? `${detail.dropped} given up on` : null,
      detail.leftByCap > 0 ? `${detail.leftByCap} not reached: the cap` : null,
    ].filter((part): part is string => part !== null);

    /**
     * "Scored 1 of 116 posts" where the run was handed more than it asked
     * about, and "Scored 116 posts" where it asked about all of them. The
     * second number is the batch, and printing it always would put "of 116" on
     * every ordinary line to no purpose.
     */
    const scored =
      skipped > 0
        ? `Scored ${detail.scored} of ${count(run.itemsIn, "post")} — ${detail.matched} matched`
        : `Scored ${count(detail.scored, "post")} — ${detail.matched} matched`;

    return extra.length > 0 ? `${scored}, ${extra.join(", ")}` : scored;
  }

  if (detail?.stage === "notify") {
    return `Sent ${count(run.itemsOut, "notification")}`;
  }

  // A stage this build has no sentence for — a worker newer than this bundle.
  // The counts are still true, so they are what it says.
  return `${run.stage}: ${run.itemsIn} in, ${run.itemsOut} out`;
}

/**
 * What a stage did, and whether the job survived it.
 *
 * Two facts and not one word. A run can write matches and still throw, and
 * this screen has to say both — the sentence for what it produced, and the
 * retry that is about to happen, which is why the same batch appears again
 * further up the list.
 */
export function stageLine(run: StageRun): string {
  const did = stageDidLabel(run);

  if (run.outcome !== "failed" || !run.detail) return did;

  return `${did} — the job failed and will be retried`;
}

/**
 * One poll and the completed processing it caused.
 *
 * A paging walk can hold several polls, so `walkId` cannot make this pairing.
 * A stage joins a poll only through its exact `pollRunId`. Older stages and
 * stages whose poll has aged out of the bounded response stay alone; placing
 * them under the nearest poll would turn an unknown relationship into a lie.
 *
 * Everything is newest first: the groups by their latest event, and the stages
 * inside one. One list cannot be read in two directions, and a reader scanning
 * a panel headed *Newest first* is looking for what happened last. The
 * sequence is not lost with the position: a stage carries its name, so
 * `classify` above `filter` still reads as the later step. The poll stays
 * above its stages because it is the group's header rather than one of them.
 */
export interface ActivityGroup {
  key: string;
  /** The newest moment in the group, which is where it sits in the list. */
  at: string;
  poll: Extract<ActivityEntry, { kind: "poll" }> | null;
  stages: Array<Extract<ActivityEntry, { kind: "stage" }>>;
}

export function activityGroupsOf(entries: readonly ActivityEntry[]): ActivityGroup[] {
  const groups: ActivityGroup[] = entries
    .filter((entry) => entry.kind === "poll")
    .map((poll) => ({ key: `poll-${poll.poll.id}`, at: poll.at, poll, stages: [] }));
  const byPoll = new Map(
    groups.flatMap((group) => (group.poll ? [[group.poll.poll.id, group] as const] : [])),
  );

  for (const stage of entries.filter((entry) => entry.kind === "stage")) {
    const group = stage.stage.pollRunId ? byPoll.get(stage.stage.pollRunId) : undefined;

    if (group) {
      group.stages.push(stage);
      if (stage.at > group.at) group.at = stage.at;
    } else {
      groups.push({ key: `stage-${stage.stage.id}`, at: stage.at, poll: null, stages: [stage] });
    }
  }

  for (const group of groups) {
    group.stages.sort((left, right) => right.at.localeCompare(left.at));
  }

  return groups.sort((left, right) => right.at.localeCompare(left.at));
}

/**
 * What the score says about a match, in two words. BUG-028.
 *
 * **It takes the score, not the intent**, and it used to be named after one:
 * "High intent" / "Worth reading" / "Low intent". A match reading *Low intent*
 * beside a panel listing *Intent 75* is two correct numbers and one wrong
 * word: a post scoring 45 overall on intent 75 and relevance 35 is somebody
 * asking urgently about something the product does not do, which is the shape
 * US-225 made relevance gate the total for.
 *
 * Banding on `match.intent` would make the label mean its name and stop it
 * summarising the match, and that row would then read "High intent" at 45.
 *
 * "Lead" rather than "match": a match is how this software thinks about a row,
 * and a lead is what the person is scanning for.
 */
export function band(score: number): { label: string; tone: string } {
  if (score >= 80) return { label: "Strong lead", tone: "high" };
  if (score >= 55) return { label: "Worth reading", tone: "medium" };
  return { label: "Weak lead", tone: "low" };
}
