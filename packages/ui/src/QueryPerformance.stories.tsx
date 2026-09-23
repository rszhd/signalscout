import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { Monitor } from "./monitor.js";
import { QueryPerformance } from "./QueryPerformance.js";
import { monitor } from "./testing/monitors.js";

const configured = monitor({
  queries: { reddit: ["flaky end-to-end tests", "manual regression testing", "qa automation"] },
  subreddits: ["QualityAssurance", "SaaS"],
}) as unknown as Monitor;

const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

const rows = [
  {
    kind: "query" as const,
    value: "flaky end-to-end tests",
    posts: 214,
    matches: 9,
    bestScore: 94,
    lastFoundAt: daysAgo(0.2),
    lastMatchedAt: daysAgo(1),
  },
  {
    kind: "query" as const,
    value: "manual regression testing",
    posts: 87,
    matches: 0,
    bestScore: null,
    lastFoundAt: daysAgo(2),
    lastMatchedAt: null,
  },
  {
    kind: "channel" as const,
    value: "QualityAssurance",
    posts: 1320,
    matches: 4,
    bestScore: 81,
    lastFoundAt: daysAgo(0.1),
    lastMatchedAt: daysAgo(45),
  },
];

const meta = {
  title: "Components/QueryPerformance",
  component: QueryPerformance,
  args: { monitor: configured, rows, onRetry: fn() },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 820 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof QueryPerformance>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Hosted: the table alone. Two configured inputs have found nothing yet. */
export const Hosted: Story = {};

/** Self-hosted adds a word to an input that never matched, or stopped matching. */
export const WithNotes: Story = {
  args: {
    note: (row) => {
      if (!row || row.posts === 0) return null;
      if (row.matches === 0 || !row.lastMatchedAt) return "Never matched";
      return Date.now() - new Date(row.lastMatchedAt).getTime() > 30 * 86_400_000
        ? "No match in 30 days"
        : null;
    },
  },
};

export const Loading: Story = { args: { rows: null } };

export const Refused: Story = {
  args: { rows: null, error: "Search performance could not be loaded." },
};

export const NoInputs: Story = {
  args: { monitor: monitor() as unknown as Monitor, rows: [] },
};
