import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MatchCard } from "./MatchCard.js";
import { match } from "./testing/matches.js";

const meta = {
  title: "Components/MatchCard",
  component: MatchCard,
  args: { match: match(), selected: false, onSelect: fn() },
  // A card is a row of the inbox list; the list's column is the page's.
  decorators: [
    (Story) => (
      <ol style={{ listStyle: "none", margin: 0, padding: 0, maxWidth: 420 }}>
        <li>
          <Story />
        </li>
      </ol>
    ),
  ],
} satisfies Meta<typeof MatchCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StrongLead: Story = {};

export const Selected: Story = { args: { selected: true } };

export const WorthReading: Story = { args: { match: match({ score: 62 }) } };

export const WeakLead: Story = { args: { match: match({ score: 41 }) } };

export const Saved: Story = { args: { match: match({ saved: true }) } };

export const JudgedGood: Story = { args: { match: match({ verdict: "good" }) } };

/** A reply: the heading is the thread's title, marked as a reply for a screen reader. */
export const Reply: Story = {
  args: {
    match: match({
      kind: "reply",
      title: null,
      parentTitle: "What do you use for flaky end-to-end tests?",
      excerpt: "We hit this too. Retries hid it for months until a release went out broken.",
    }),
  },
};

/** A post with no title, as on X: the text is the heading. */
export const NoTitle: Story = {
  args: {
    match: match({
      source: "x",
      channel: null,
      author: "maria_builds",
      title: null,
      excerpt: "Is there a tool that tells me which of our tests fail without a code change?",
    }),
  },
};

export const LongTitle: Story = {
  args: {
    match: match({
      title:
        "Our regression suite takes forty minutes and fails at random about one run in five — how do other small teams keep a release process that people still trust?",
    }),
  },
};
