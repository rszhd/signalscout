/**
 * What both products say about a match: where it came from, how much of its
 * thread was read, and how much of it the reading pane shows first. US-352.
 *
 * `band`, the two words for a score, is in `monitor.ts` with the other words
 * about a monitor's output. `MatchCard` and `MatchDetail` render these; the
 * inbox around them — filters, paging, the address — is each application's.
 */

export type Verdict = "good" | "not_relevant";

/** A match as `/api/matches` sends it. */
export interface Match {
  id: string;
  monitorId: string;
  monitorName: string;
  score: number;
  problemFit: number;
  icpFit: number;
  intent: number;
  intentLabel: string;
  reasons: string[];
  /** Null when this person has not judged the match yet. */
  verdict: Verdict | null;
  source: string;
  channel: string | null;
  author: string | null;
  title: string | null;
  excerpt: string;
  /** "post" or "reply". */
  kind: string;
  /** The thread above a reply. Null on a post, and on an orphaned reply. */
  parentTitle: string | null;
  parentExcerpt: string | null;
  parentUrl: string | null;
  /**
   * How deep the thread above a reply was read, and why it stopped.
   *
   * Optional rather than nullable: a browser holding this build can be talking
   * to an API that predates it, and then these keys are absent. Optional makes
   * the compiler ask about that at every use site (US-048).
   */
  parentRepliesRead?: number | null;
  parentReplyCount?: number | null;
  parentRepliesStopped?: string | null;
  /** Kept for later. Not a verdict; a person's intention. */
  saved: boolean;
  /**
   * The person said they replied. US-396. Optional for the reason the thread
   * depth is: an API that predates it does not send it, and absent reads as no.
   */
  replied?: boolean;
  url: string;
  postedAt: string;
}

/** How many words of a post the reading pane shows before "Read more". */
export const postPreviewWordLimit = 80;

export function limitWords(
  body: string,
  limit = postPreviewWordLimit,
): { text: string; truncated: boolean } {
  const words = body.trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return { text: body, truncated: false };

  return { text: `${words.slice(0, limit).join(" ")}…`, truncated: true };
}

export interface PlatformLabel {
  name: string;
  where: (match: Match) => string | undefined;
  /**
   * Whether this platform's own link opens the comment, or only the thread.
   *
   * It decides what the button may promise. An unknown platform is "thread":
   * a button that over-promises sends somebody looking for a comment that was
   * never there (US-047).
   */
  commentLink: "comment" | "thread";
}

/**
 * How each platform names itself and the place a post came from. A table
 * rather than a branch, because a branch answers "not X, so Reddit" and is
 * wrong the moment another platform exists (US-028).
 */
const platformLabels: Record<string, PlatformLabel> = {
  reddit: {
    name: "Reddit",
    where: (match) => (match.channel ? `r/${match.channel}` : undefined),
    commentLink: "comment",
  },
  x: {
    name: "X",
    where: (match) => (match.author ? `@${match.author}` : undefined),
    commentLink: "comment",
  },
  linkedin: {
    name: "LinkedIn",
    // The stored author is the profile slug out of the post URL.
    where: (match) => (match.author ? `@${match.author}` : undefined),
    commentLink: "comment",
  },
  youtube: {
    name: "YouTube",
    where: (match) => (match.channel ? match.channel : undefined),
    commentLink: "comment",
  },
  tiktok: {
    name: "TikTok",
    // The creator: a video has no title, only a caption.
    where: (match) => (match.author ? `@${match.author}` : undefined),
    // `?cid=`, the link TikTok puts in a comment notification.
    commentLink: "comment",
  },
};

export function platformLabel(source: string): PlatformLabel {
  return platformLabels[source] ?? { name: source, where: () => undefined, commentLink: "thread" };
}

/** "Reddit · r/devops", or the platform alone when there is no place. */
export function whereItCameFrom(match: Match): string {
  const platform = platformLabel(match.source);
  const channel = platform.where(match);

  return channel ? `${platform.name} · ${channel}` : platform.name;
}

/** Whether the conversation link can only open the post, not the reply itself. */
export function opensThreadOnly(match: Match): boolean {
  return match.kind === "reply" && platformLabel(match.source).commentLink === "thread";
}

/**
 * How much of a reply's thread was read, and why it stopped, or nothing.
 *
 * The reason is the half nobody could infer: "stopped, two batches held
 * nothing" and "stopped, out of budget" call for different actions. Nothing
 * is said while the thread is still being read, because a count that moves on
 * its own invites a reading (US-048).
 */
export function threadDepth(match: Match): string | undefined {
  if (match.kind !== "reply") return undefined;

  // `== null`, not `=== null`: an older API leaves the field out, and
  // `undefined.toLocaleString()` took the whole inbox down once.
  const read = match.parentRepliesRead;
  if (read == null || read === 0) return undefined;

  const total = match.parentReplyCount;
  const of = total != null && total > read ? ` of ${total.toLocaleString()}` : "";
  const counted = `${read.toLocaleString()}${of} comment${read === 1 ? "" : "s"} read`;

  switch (match.parentRepliesStopped) {
    case "threshold":
      return `${counted}. Stopped: the last batch held no lead.`;
    case "ceiling":
      return `${counted}. Stopped: this is as deep as one thread is read.`;
    case "budget":
      return `${counted}. Stopped: the monitor reached its budget.`;
    case "end":
      return `${counted} — the whole thread.`;
    default:
      return undefined;
  }
}

/**
 * The orders the inbox offers, and what its list heading calls each. An order
 * is not a filter: it sits beside the monitor picker, outside the Filters
 * panel, and never counts in its badge. "Best" fits the control; the heading
 * has room for the sentence that says what it means.
 */
export const inboxOrders = [
  { value: "rank", label: "Best", heading: "Ranked by score & age" },
  { value: "score", label: "Score", heading: "Highest score first" },
  { value: "newest", label: "Newest", heading: "Newest first" },
] as const;

export type InboxOrder = (typeof inboxOrders)[number]["value"];

export const scoreFilters = [
  { value: 0, label: "Any score" },
  { value: 50, label: "50 and above" },
  { value: 70, label: "70 and above" },
  { value: 85, label: "85 and above" },
] as const;

/** What narrows the inbox, as the filter bar shows it. */
export interface InboxFilterState {
  readonly monitors: readonly { readonly id: string }[];
  readonly monitorId: string;
  readonly minScore: number;
  readonly showDismissed: boolean;
  /** Replied matches left out. Optional: a page without the filter has none. US-396. */
  readonly hideReplied?: boolean;
}

/**
 * How many filters narrow the list: the Filters badge, and whether an empty
 * list says "no matches with these filters". The monitor counts only when
 * there is a choice — with one monitor the picker is hidden, and a filter a
 * person cannot see must not be why their inbox is empty.
 */
export function activeFilters(state: InboxFilterState): number {
  const byMonitor = state.monitors.length > 1 && state.monitorId !== "";
  return (
    Number(byMonitor) +
    Number(state.minScore > 0) +
    Number(state.showDismissed) +
    Number(state.hideReplied === true)
  );
}
