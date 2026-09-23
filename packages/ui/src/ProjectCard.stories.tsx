import type { Meta, StoryObj } from "@storybook/react-vite";
import { Link } from "react-router";
import { fn } from "storybook/test";
import { ProjectCard } from "./ProjectCard.js";

const meta = {
  title: "Components/ProjectCard",
  component: ProjectCard,
  // A card is a list item; the list's grid is the page's.
  decorators: [
    (Story) => (
      <ul style={{ listStyle: "none", margin: 0, padding: 0, maxWidth: 440 }}>
        <Story />
      </ul>
    ),
  ],
  args: {
    name: "Flaky test finder",
    inboxHref: "/projects/1",
    editHref: "/projects/1/edit",
    product: "A CI plugin that finds the tests that fail without a code change.",
    audience: "Engineering leads at companies with a slow, unreliable test suite.",
    status: "2 monitors",
    deleteQuestion: "Delete Flaky test finder and its 2 monitors? This cannot be undone.",
    confirming: false,
    deleting: false,
    onAskDelete: fn(),
    onKeep: fn(),
    onDelete: fn(),
  },
} satisfies Meta<typeof ProjectCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Self-hosted: the status is a count and the second action makes the next monitor. */
export const SelfHosted: Story = {
  args: {
    actions: (
      <Link className="secondary-button" to="/projects/1/monitors/new">
        New monitor
      </Link>
    ),
  },
};

/** Hosted: the status is the one monitor's state, and the action opens it. */
export const HostedRunning: Story = {
  args: {
    status: "Collecting now",
    statusTone: "running",
    actions: (
      <Link className="secondary-button" to="/projects/1/monitors">
        View monitor
      </Link>
    ),
  },
};

export const Waiting: Story = {
  args: { status: "Next poll in 42 minutes", statusTone: "waiting" },
};

export const Paused: Story = { args: { status: "Paused", statusTone: "paused" } };

export const ConfirmingDelete: Story = { args: { confirming: true } };

export const Deleting: Story = { args: { confirming: true, deleting: true } };

export const LongName: Story = {
  args: {
    name: "An unusually long project name that has to wrap onto a second line",
    status: "No monitors yet",
  },
};
