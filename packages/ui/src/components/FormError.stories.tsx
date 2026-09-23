import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.js";
import { FormError } from "./FormError.js";

const meta = {
  title: "Primitives/FormError",
  component: FormError,
  args: { children: "The name is already used by another project." },
} satisfies Meta<typeof FormError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Refusal: Story = {};

export const WithAction: Story = {
  args: {
    children: "The draft could not be written.",
    action: <Button variant="compact">Try again</Button>,
  },
};
