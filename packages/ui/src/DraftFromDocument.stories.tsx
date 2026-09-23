import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { DraftFromDocument } from "./DraftFromDocument.js";

const drafted = {
  name: "Acme QA",
  product: "A test runner that finds the tests that fail without a code change.",
  idealCustomer: "Engineering leads at small SaaS teams.",
  problem: "Releases wait on a manual check of every major flow.",
  missing: [],
  charactersRead: 4200,
  truncated: false,
};

const meta = {
  title: "Components/DraftFromDocument",
  component: DraftFromDocument,
  args: { disabled: false, onDrafted: () => {}, onBusy: () => {} },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 640 }}>
        <Story />
      </div>
    ),
  ],
  parameters: { api: { "POST /api/projects/describe": { body: drafted, delay: 600 } } },
} satisfies Meta<typeof DraftFromDocument>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const Disabled: Story = { args: { disabled: true } };

export const Reading: Story = {
  parameters: { api: { "POST /api/projects/describe": { delay: "never" } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Your product's address"), "https://acme.test");
    await userEvent.click(canvas.getByRole("button", { name: "Read this page" }));
  },
};

/** The server's own sentence, which names the host and the status. */
export const Refused: Story = {
  parameters: {
    api: {
      "POST /api/projects/describe": {
        status: 422,
        body: { message: "acme.test answered 404. Check the address and try again." },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Your product's address"), "https://acme.test");
    await userEvent.click(canvas.getByRole("button", { name: "Read this page" }));
    await expect(await canvas.findByRole("alert")).toBeVisible();
  },
};
