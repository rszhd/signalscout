import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ReplyDraft } from "./ReplyDraft.js";

const voices = [
  {
    id: "1f0f5e0a-0000-4000-8000-000000000001",
    name: "Short and plain",
    instruction: "Write plainly, no exclamation marks.",
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  },
  {
    id: "1f0f5e0a-0000-4000-8000-000000000002",
    name: "Founder, first person",
    instruction: "Speak as the founder. Say what we built and why, once.",
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
  },
];

const draft = {
  reply:
    "Retries hide the flake rather than fix it. We had the same problem and ended up " +
    "tracking which tests fail without a code change. [check: whether they use CI at all]",
  uncertainties: ["Whether they are running these in CI"],
  model: "gpt-5.6-terra",
  estimatedCostMicros: 2975,
};

const meta = {
  title: "Screens/ReplyDraft",
  component: ReplyDraft,
  args: { matchId: "8d2b4a1e-3f5c-4c7a-9e11-2b6d0c4f7a31" },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 640 }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    api: {
      "GET /api/reply-prompts": { body: { prompts: voices } },
      "POST /api/matches/*/draft": { body: draft, delay: 400 },
    },
  },
} satisfies Meta<typeof ReplyDraft>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing is written until the button is pressed. */
export const BeforeDrafting: Story = {};

export const NoSavedVoices: Story = {
  parameters: { api: { "GET /api/reply-prompts": { body: { prompts: [] } } } },
};

export const Drafted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Draft reply" }));
    await expect(await canvas.findByRole("button", { name: "Copy draft" })).toBeVisible();
  },
};

export const Writing: Story = {
  parameters: {
    api: {
      "GET /api/reply-prompts": { body: { prompts: voices } },
      "POST /api/matches/*/draft": { delay: "never" },
    },
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Draft reply" }));
  },
};

export const Refused: Story = {
  parameters: {
    api: {
      "GET /api/reply-prompts": { body: { prompts: voices } },
      "POST /api/matches/*/draft": {
        status: 409,
        body: { message: "No model is set for drafting. Choose one on the Models screen." },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Draft reply" }));
    await expect(await canvas.findByRole("alert")).toBeVisible();
  },
};
