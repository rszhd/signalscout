import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandLogo } from "./BrandLogo.js";

const meta = {
  title: "Brand/BrandLogo",
  component: BrandLogo,
  args: { size: 32 },
} satisfies Meta<typeof BrandLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The sidebar's size. */
export const Sidebar: Story = {};

/** The onboarding page's size. */
export const Onboarding: Story = { args: { size: 40 } };

/** Beside the name, the way the sidebar and the login header set it. */
export const WithName: Story = {
  render: (args) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 12, fontWeight: 700 }}>
      <BrandLogo {...args} />
      SignalScout
    </span>
  ),
};
