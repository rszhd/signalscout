import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./components/Button.js";
import { Field } from "./components/Field.js";
import { LoginFrame } from "./LoginFrame.js";

/**
 * A stand-in for a screen, in the shape the frame lays out: the heading on
 * the left, the form on the right, the buttons in one row at its end.
 */
function Form() {
  return (
    <section className="login-card" aria-labelledby="story-login-title">
      <div className="login-head">
        <h1 id="story-login-title">Sign in</h1>
        <p className="page-subtitle">Use your SignalScout account.</p>
      </div>
      <form className="login-body field-stack">
        <Field label="Email">
          <input type="email" placeholder="you@example.com" />
        </Field>
        <Field label="Password">
          <input type="password" placeholder="Enter your password" />
        </Field>
        <div className="login-actions">
          <button type="button" className="login-text-button">
            Create an account
          </button>
          <Button variant="primary" type="submit">
            Sign in
          </Button>
        </div>
      </form>
    </section>
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
