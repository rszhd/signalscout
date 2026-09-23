import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Button } from "./Button.js";

const meta = {
  title: "Primitives/Button",
  component: Button,
  args: { children: "Save changes", onClick: fn() },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "secondary", "compact"] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: "primary" } };

export const Secondary: Story = { args: { variant: "secondary" } };

export const Compact: Story = { args: { variant: "compact", children: "Filters" } };

export const Disabled: Story = { args: { variant: "primary", disabled: true } };

/** The three intents side by side, the way a toolbar and a form footer use them. */
export const Together: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Button variant="primary">Create monitor</Button>
      <Button variant="secondary">Cancel</Button>
      <Button variant="compact">Filters · 2</Button>
    </div>
  ),
};
