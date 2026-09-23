import type { Meta, StoryObj } from "@storybook/react-vite";
import { MonitorStatus } from "./MonitorStatus.js";

const meta = {
  title: "Components/MonitorStatus",
  component: MonitorStatus,
  args: { label: "Running", tone: "running" },
  argTypes: { tone: { control: "inline-radio", options: ["running", "paused", "stopped"] } },
} satisfies Meta<typeof MonitorStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};

/** A poll that returned nothing: still running, but quiet, so the dot stops. */
export const FoundNothing: Story = { args: { label: "Found nothing", attention: true } };

export const Paused: Story = { args: { label: "Paused", tone: "paused" } };

export const BudgetSpent: Story = { args: { label: "Budget spent", tone: "stopped" } };

/** Every word `status()` can say, side by side. */
export const All: Story = {
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      <MonitorStatus label="Running" tone="running" />
      <MonitorStatus label="Found nothing" tone="running" attention />
      <MonitorStatus label="Paused" tone="paused" />
      <MonitorStatus label="Budget spent" tone="stopped" />
      <MonitorStatus label="Needs a key" tone="stopped" />
      <MonitorStatus label="Poll failed" tone="stopped" />
    </div>
  ),
};
