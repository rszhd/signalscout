import type { Meta, StoryObj } from "@storybook/react-vite";
import { MonitoringBar } from "./MonitoringBar.js";
import { type Monitor, monitoringState, type PollSentence } from "./monitor.js";
import { monitor, poll } from "./testing/monitors.js";

/**
 * The last poll twenty minutes ago, on the real clock: the age beside it reads
 * the clock too, so a fixed date would say "193 days ago".
 */
const now = Date.now();
const polledAt = new Date(now - 20 * 60_000).toISOString();

/** The state the words give a monitor, the way a screen gets it. */
function stateOf(overrides: Record<string, unknown>, sentence: PollSentence = {}) {
  const row = monitor({ lastPolledAt: polledAt, ...overrides }) as unknown as Monitor;
  const state = monitoringState([row], now, sentence);
  if (!state) throw new Error("the fixture has no monitoring state");
  return state;
}

const spend = monitor().spend;
const lastPoll = (overrides: Record<string, unknown> = {}) =>
  poll({ startedAt: polledAt, finishedAt: polledAt, ...overrides });
const collected = lastPoll({ outcome: "collected", postsReturned: 40, postsNew: 12 });

const meta = {
  title: "Components/MonitoringBar",
  component: MonitoringBar,
  args: { monitorHref: "/projects/p1/monitors", state: stateOf({ lastPoll: collected }) },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MonitoringBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};

/** Hosted: the same sentence without the dollars (US-173 there). */
export const RunningHosted: Story = {
  args: { state: stateOf({ lastPoll: collected }, { spend: false }) },
};

export const FirstPollAhead: Story = { args: { state: stateOf({}) } };

/** A poll that returned nothing: running, but quiet, and worth a look. */
export const FoundNothing: Story = { args: { state: stateOf({ lastPoll: lastPoll() }) } };

export const Paused: Story = { args: { state: stateOf({ paused: true, lastPoll: collected }) } };

export const BudgetSpent: Story = {
  args: {
    state: stateOf({ spend: { ...spend, exhausted: true, reason: "budget" }, lastPoll: collected }),
  },
};

export const NeedsAKey: Story = {
  args: {
    state: stateOf({
      missingCredentials: [{ environmentVariable: "SOCIALCRAWL_API_KEY" }],
      lastPoll: collected,
    }),
  },
};
