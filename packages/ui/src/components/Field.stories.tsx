import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "./Field.js";

const meta = {
  title: "Primitives/Field",
  component: Field,
  args: {
    label: "Project name",
    children: <input defaultValue="Flaky test finder" />,
  },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Text: Story = {};

export const WithHint: Story = {
  args: {
    label: "Minimum score",
    hint: "A post that scores below this never reaches the inbox.",
    children: <input type="number" defaultValue={60} min={0} max={100} />,
  },
};

export const Select: Story = {
  args: {
    label: "Digest interval (hours)",
    children: (
      <select defaultValue="24">
        <option value="6">6</option>
        <option value="12">12</option>
        <option value="24">24</option>
      </select>
    ),
  },
};

export const TextArea: Story = {
  args: {
    label: "Instruction",
    hint: "Optional",
    children: <textarea rows={4} defaultValue="Write plainly, no exclamation marks." />,
  },
};
