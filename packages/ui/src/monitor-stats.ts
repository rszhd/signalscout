/**
 * What the monitor page's two tables read: how each search input performs,
 * and where the leads come from. US-353.
 *
 * The rows are the API's; each application fetches them, because the two
 * APIs answer in different shapes (the self-hosted one adds a score floor and
 * the date an input last matched). The optional fields are those.
 */

import { platformName } from "./labels.js";
import type { Monitor } from "./monitor.js";

/** One search input's results, as `/api/monitors/:id/queries` sends it. */
export interface QueryPerformanceRow {
  kind: "query" | "channel";
  value: string;
  posts: number;
  matches: number;
  bestScore: number | null;
  lastFoundAt: string | null;
  /** Self-hosted only: when this input last produced a match. */
  lastMatchedAt?: string | null;
}

export interface SearchInput {
  kind: QueryPerformanceRow["kind"];
  value: string;
}

export function inputKey(input: SearchInput): string {
  return `${input.kind}:${input.value}`;
}

/**
 * The inputs a monitor is configured with, deduplicated. An input that has
 * never returned a post has no row, and the table still lists it: an input
 * that finds nothing is the one a person most needs to see.
 */
export function searchInputs(monitor: Monitor): SearchInput[] {
  const inputs: SearchInput[] = [
    ...Object.values(monitor.queries ?? {}).flatMap((queries) =>
      queries.map((value) => ({ kind: "query" as const, value: value.trim() })),
    ),
    ...(monitor.subreddits ?? []).map((value) => ({
      kind: "channel" as const,
      value: value.trim(),
    })),
  ].filter((input) => input.value !== "");

  return [...new Map(inputs.map((input) => [inputKey(input), input])).values()];
}

/** One group of matches, as `/api/monitors/:id/leads` sends it. */
export interface LeadGroup {
  value: string;
  /** Self-hosted only: the API's own name for the group. */
  label?: string;
  source: string | null;
  matches: number;
  averageScore: number;
  bestScore: number;
  strong: number;
}

export interface LeadBreakdown {
  platforms: LeadGroup[];
  channels: LeadGroup[];
  kinds: LeadGroup[];
  intents: LeadGroup[];
  /** Self-hosted only: the score a post needed to become a match. */
  floor?: number;
}

export type LeadDimension = "platforms" | "channels" | "kinds" | "intents";

export interface LeadDimensionWords {
  label: string;
  itemLabel: string;
  empty: string;
}

export const leadDimensionWords: Readonly<Record<LeadDimension, LeadDimensionWords>> = {
  platforms: {
    label: "Platforms",
    itemLabel: "Platform",
    empty: "No platform information is available for these matches.",
  },
  channels: {
    label: "Channels",
    itemLabel: "Channel",
    empty: "No channel information is available for these matches.",
  },
  kinds: {
    label: "Posts vs. comments",
    itemLabel: "Kind",
    empty: "No post or comment information is available for these matches.",
  },
  intents: {
    label: "Intent",
    itemLabel: "Intent",
    empty: "No intent information is available for these matches.",
  },
};

/**
 * The groups `LeadSources` offers when the page names none. Posts against
 * comments is left out: it answers a question about the pipeline, not about
 * which query, channel or intent to change next. The API still sends it.
 */
export const defaultLeadDimensions: readonly LeadDimension[] = ["platforms", "channels", "intents"];

const intentNames: Readonly<Record<string, string>> = {
  recommendation_request: "Asking for recommendations",
  alternative_search: "Looking for alternatives",
  competitor_complaint: "Complaining about their current solution",
  problem: "Describing the problem",
  comparison: "Comparing products",
  purchase: "Ready to buy",
  hiring: "Looking to hire someone",
  none: "No clear intent",
};

function words(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function leadGroupName(dimension: LeadDimension, row: LeadGroup): string {
  if (dimension === "platforms") return platformName(row.value);
  if (dimension === "channels") return row.source === "reddit" ? `r/${row.value}` : row.value;
  if (dimension === "kinds") {
    if (row.value === "post") return "Posts";
    if (row.value === "reply") return "Replies and comments";
  }
  if (row.label) return row.label;
  if (dimension === "intents") return intentNames[row.value] ?? words(row.value);

  return words(row.value);
}
