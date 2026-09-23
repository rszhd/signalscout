import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { expect, userEvent, within } from "storybook/test";
import { Button } from "./Button.js";
import { Dialog } from "./Dialog.js";

/** A dialog opens with `showModal` on its ref, so every story has a button. */
function Opener({ body }: { readonly body: string }) {
  const dialog = useRef<HTMLDialogElement | null>(null);

  return (
    <>
      <Button variant="primary" onClick={() => dialog.current?.showModal()}>
        Open dialog
      </Button>
      <Dialog
        titleId="story-dialog-title"
        closeLabel="Close the dialog"
        heading={<h2 id="story-dialog-title">Delete this monitor?</h2>}
        dialogRef={dialog}
      >
        {/* The body's padding is the caller's: `.app-dialog` has none. */}
        <p style={{ margin: 0, padding: "var(--space-6)" }}>{body}</p>
      </Dialog>
    </>
  );
}

const meta = {
  title: "Primitives/Dialog",
  component: Opener,
  args: {
    body: "Its matches and its history are deleted with it. This cannot be undone.",
  },
} satisfies Meta<typeof Opener>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Open dialog" }));
    await expect(within(document.body).getByRole("dialog")).toBeVisible();
  },
};
