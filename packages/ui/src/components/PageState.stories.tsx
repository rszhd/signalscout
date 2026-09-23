import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.js";
import { PageState } from "./PageState.js";

const meta = {
  title: "Primitives/PageState",
  component: PageState,
  argTypes: { kind: { control: "inline-radio", options: ["loading", "empty", "error"] } },
} satisfies Meta<typeof PageState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: { kind: "loading", heading: "Loading the inbox", children: "Reading your matches." },
};

export const Empty: Story = {
  args: {
    kind: "empty",
    mark: "✦",
    heading: "Nothing has matched yet",
    children:
      "Your monitors collect on their own schedule. Matches appear here as they are scored.",
    action: <Button>Check again</Button>,
  },
};

export const ErrorState: Story = {
  name: "Error",
  args: {
    kind: "error",
    heading: "The inbox could not be loaded",
    children: "The API answered 503.",
    action: <Button>Try again</Button>,
  },
};

/** Inside a panel rather than a page: no page padding. */
export const Inline: Story = {
  args: { kind: "loading", page: false, children: "Reading search performance." },
};
