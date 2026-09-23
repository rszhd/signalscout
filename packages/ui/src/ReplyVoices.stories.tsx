import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ApiAnswer } from "../.storybook/api.js";
import { ReplyVoices } from "./ReplyVoices.js";

const voices = [
  {
    id: "1f0f5e0a-0000-4000-8000-000000000001",
    name: "Short and plain",
    instruction: "Write plainly, no exclamation marks.",
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  },
  {
    id: "1f0f5e0a-0000-4000-8000-000000000002",
    name: "Founder, first person",
    instruction: "Speak as the founder. Say what we built and why, once.",
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
  },
];

const presets = [
  {
    id: "helpful-peer",
    name: "Helpful peer",
    instruction: "Answer the question first. Mention the product only if it answers it.",
    why: "People trust a reply that helps before it sells.",
  },
  {
    id: "brief",
    name: "Brief",
    instruction: "Three sentences at most.",
    why: "A long reply to a short question reads as an advert.",
  },
];

/** Saving echoes the voice back, the way the route does. */
const saved = ({ body }: { body: unknown }): ApiAnswer => ({
  status: 201,
  body: { ...voices[0], ...(body as object) },
});

function api(prompts: unknown[]) {
  return {
    "GET /api/reply-prompts/presets": { body: { presets } },
    "GET /api/reply-prompts": { body: { prompts } },
    "POST /api/reply-prompts": saved,
    "PATCH /api/reply-prompts/*": saved,
    "DELETE /api/reply-prompts/*": { status: 204 },
  };
}

const meta = {
  title: "Screens/ReplyVoices",
  component: ReplyVoices,
  parameters: { layout: "fullscreen", api: api(voices) },
} satisfies Meta<typeof ReplyVoices>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithVoices: Story = {};

/** The first visit: the presets and the form for a first voice. */
export const FirstVoice: Story = { parameters: { api: api([]) } };

export const Loading: Story = {
  parameters: { api: { "GET /api/reply-prompts": { delay: "never" } } },
};

export const LoadFailed: Story = {
  parameters: {
    api: {
      "GET /api/reply-prompts/presets": { body: { presets } },
      "GET /api/reply-prompts": { status: 503, body: { message: "The API is not reachable." } },
    },
  },
};
