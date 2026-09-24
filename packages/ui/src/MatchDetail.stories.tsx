import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MatchDetail } from "./MatchDetail.js";
import { match } from "./testing/matches.js";

const longPost = [
  "We are a team of six and we still check every major flow by hand before a release.",
  "It takes most of a Friday. We tried recording tests with a browser extension, but the",
  "recordings broke every time the design changed, and nobody had the time to repair them.",
  "Then we wrote a few end-to-end tests ourselves, and now about one run in five fails for",
  "no reason we can find. People have started to ignore the failures, which is worse than",
  "having no tests at all. How are other small teams handling this? Is there a tool that",
  "tells you which tests fail without a code change, so we can fix those first?",
].join(" ");

const meta = {
  title: "Components/MatchDetail",
  component: MatchDetail,
  args: {
    match: match(),
    saving: false,
    judging: false,
    onSave: fn(),
    onJudge: fn(),
    onBack: fn(),
  },
  parameters: {
    layout: "fullscreen",
    // The composer inside the pane reads the saved voices.
    api: { "GET /api/reply-prompts": { body: { prompts: [] } } },
  },
} satisfies Meta<typeof MatchDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Post: Story = {};

/** A product's own button, in the slot beside the conversation link. */
export const WithProductAction: Story = {
  args: {
    actions: (
      <button className="secondary-button" type="button">
        A product action
      </button>
    ),
  },
};

export const LongPost: Story = { args: { match: match({ excerpt: longPost }) } };

/** A reply, with the thread above it and how much of the thread was read. */
export const Reply: Story = {
  args: {
    match: match({
      kind: "reply",
      title: null,
      parentTitle: "What do you use for flaky end-to-end tests?",
      parentExcerpt: longPost,
      parentRepliesRead: 100,
      parentReplyCount: 1713,
      parentRepliesStopped: "threshold",
      excerpt: "We hit this too. Retries hid it for months until a release went out broken.",
    }),
  },
};

/** A platform whose link cannot open one comment: the pane says so before the link. */
export const ReplyThreadOnly: Story = {
  args: {
    match: match({
      kind: "reply",
      source: "mastodon",
      channel: null,
      author: "maria",
      title: null,
      parentTitle: "Flaky tests",
      parentExcerpt: "Which tool tells you a test is flaky?",
      excerpt: "We built our own and regret it.",
    }),
  },
};

export const SavedAndJudged: Story = {
  args: { match: match({ saved: true, verdict: "good" }) },
};

export const Saving: Story = { args: { saving: true, judging: true } };
