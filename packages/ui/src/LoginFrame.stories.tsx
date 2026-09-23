import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./components/Button.js";
import { Field } from "./components/Field.js";
import { LoginFrame } from "./LoginFrame.js";

/**
 * A stand-in for the form. The real card is each application's, with its own
 * rules in its own `login.css`, so it is plain here on purpose.
 */
function Form() {
  return (
    <form
      style={{
        display: "grid",
        gap: 16,
        width: "100%",
        maxWidth: 440,
        justifySelf: "center",
        padding: 32,
        borderRadius: 12,
        background: "var(--surface)",
      }}
    >
      <h1 style={{ margin: 0 }}>Sign in</h1>
      <Field label="Email">
        <input type="email" placeholder="you@example.com" />
      </Field>
      <Field label="Password">
        <input type="password" placeholder="Enter your password" />
      </Field>
      <Button variant="primary" type="submit">
        Sign in
      </Button>
    </form>
  );
}

const meta = {
  title: "Screens/LoginFrame",
  component: LoginFrame,
  args: { children: <Form /> },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LoginFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Hosted: Story = {};

/** Self-hosted says whose accounts and keys these are, under the story. */
export const SelfHosted: Story = {
  args: {
    storyNote: "Your accounts. Your API keys. Your data.",
    footer: "Open-source AI intent monitoring.",
  },
};
