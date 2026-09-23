import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MonitorHistory } from "./MonitorHistory.js";
import { pollEntry, stageEntry } from "./testing/activity.js";

/** Minutes before now: an age label reads the real clock. */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Two polls, the newer one with its filter and classifier runs under it. */
const entries = [
  stageEntry({ startedAt: ago(14), pollRunId: "poll-2" }),
  stageEntry({
    id: "stage-0",
    stage: "filter",
    startedAt: ago(18),
    pollRunId: "poll-2",
    itemsIn: 72,
    itemsOut: 12,
    detail: null,
  }),
  pollEntry({
    id: "poll-2",
    startedAt: ago(20),
    outcome: "collected",
    postsReturned: 72,
    postsNew: 40,
    sources: [
      {
        source: "reddit",
        provider: "socialcrawl",
        pages: 5,
        postsReturned: 72,
        postsNew: 40,
        units: 67,
        estimatedCostMicros: 543906,
        reason: null,
      },
    ],
  }),
  pollEntry({ startedAt: ago(80), finishedAt: ago(79) }),
];

const meta = {
  title: "Components/MonitorHistory",
  component: MonitorHistory,
  args: { entries },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 760 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MonitorHistory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PollsAndStages: Story = {};

/** Hosted: the same sentences without the dollars. */
export const Hosted: Story = { args: { sentence: { spend: false } } };

/** Self-hosted pages the history, and says where the stage record ends. */
export const Paged: Story = {
  args: {
    more: true,
    onShowOlder: fn(),
    stagesRecordedSince: ago(60),
  },
};

export const LoadingOlder: Story = { args: { more: true, onShowOlder: fn(), loadingOlder: true } };

export const Loading: Story = { args: { entries: null } };

export const NothingYet: Story = { args: { entries: [] } };

export const Refused: Story = { args: { error: "The history could not be loaded." } };
