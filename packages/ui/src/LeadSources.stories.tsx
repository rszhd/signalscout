import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { LeadSources } from "./LeadSources.js";
import type { LeadBreakdown, LeadGroup } from "./monitor-stats.js";

const group = (overrides: Partial<LeadGroup>): LeadGroup => ({
  value: "reddit",
  source: null,
  matches: 12,
  averageScore: 68,
  bestScore: 94,
  strong: 5,
  ...overrides,
});

const breakdown: LeadBreakdown = {
  platforms: [
    group({}),
    group({ value: "x", matches: 4, averageScore: 61, bestScore: 83, strong: 1 }),
  ],
  channels: [
    group({ value: "SaaS", source: "reddit", matches: 7 }),
    group({ value: "QualityAssurance", source: "reddit", matches: 5, strong: 3 }),
  ],
  kinds: [group({ value: "post", matches: 11 }), group({ value: "reply", matches: 5 })],
  intents: [
    group({ value: "alternative_search", matches: 6 }),
    group({ value: "problem", matches: 10, strong: 2 }),
  ],
};

const meta = {
  title: "Components/LeadSources",
  component: LeadSources,
  args: { breakdown, onRetry: fn() },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 820 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LeadSources>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Hosted: platforms, channels and intent. */
export const Hosted: Story = {};

/** Self-hosted offers posts against comments too. */
export const FourGroups: Story = {
  args: { dimensions: ["platforms", "channels", "kinds", "intents"] },
};

export const NoMatchesYet: Story = {
  args: { breakdown: { platforms: [], channels: [], kinds: [], intents: [] } },
};

export const Loading: Story = { args: { breakdown: null } };

export const Refused: Story = {
  args: { breakdown: null, error: "Lead sources could not be loaded." },
};
