// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplyVoices } from "./ReplyVoices.js";
import { button, field, json, mount, type Screen, settle, setValue } from "./testing.js";

function voice(overrides: Record<string, unknown> = {}) {
  return {
    id: "1f0f5e0a-0000-4000-8000-000000000001",
    name: "Short and plain",
    instruction: "Write plainly, no exclamation marks.",
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
    ...overrides,
  };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function server(initial: ReturnType<typeof voice>[] = []) {
  const calls: Call[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });

    if (method === "GET") return Promise.resolve(json({ prompts: initial }));
    if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));

    return Promise.resolve(
      json(
        voice({
          ...(method === "POST" ? { id: "1f0f5e0a-0000-4000-8000-000000000002" } : initial[0]),
          ...body,
        }),
        method === "POST" ? 201 : 200,
      ),
    );
  }) as unknown as typeof fetch);

  return calls;
}

let screen: Screen;

async function press(label: string): Promise<void> {
  button(label).click();
  await settle();
}

beforeEach(() => vi.restoreAllMocks());

afterEach(async () => {
  await screen?.unmount();
});

describe("the account reply-voice library", () => {
  it("opens an existing voice in a focused editor", async () => {
    server([voice()]);
    screen = await mount(<ReplyVoices />);

    expect(screen.container.textContent).toContain("Reply voices");
    expect(field("Voice name").value).toBe("Short and plain");
    expect(field("Voice instructions").value).toBe("Write plainly, no exclamation marks.");
    expect(screen.container.textContent).toContain(
      "available when drafting a reply in any project",
    );
  });

  it("creates a reusable voice away from the conversation", async () => {
    const calls = server();
    screen = await mount(<ReplyVoices />);

    await press("New voice");
    setValue(field("Voice name"), "Warm and concise");
    setValue(field("Voice instructions"), "Lead with the answer and keep it warm.");
    await settle();
    await press("Create voice");

    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      name: "Warm and concise",
      instruction: "Lead with the answer and keep it warm.",
    });
    expect(screen.container.textContent).toContain("Voice created.");
  });

  it("updates the name and instruction together", async () => {
    const calls = server([voice()]);
    screen = await mount(<ReplyVoices />);

    setValue(field("Voice name"), "Direct");
    setValue(field("Voice instructions"), "Answer first. Use two short paragraphs.");
    await settle();
    await press("Save changes");

    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({
      name: "Direct",
      instruction: "Answer first. Use two short paragraphs.",
    });
    expect(screen.container.textContent).toContain("Voice saved.");
  });

  it("asks once more before deleting an account-wide voice", async () => {
    const calls = server([voice()]);
    screen = await mount(<ReplyVoices />);

    await press("Delete voice");
    expect(screen.container.textContent).toContain("Delete “Short and plain”?");

    await press("Yes, delete");

    expect(calls.find((call) => call.method === "DELETE")?.url).toContain(voice().id);
    expect(screen.container.textContent).toContain("Create your first reply voice");
  });

  it("does not enable an incomplete voice", async () => {
    server();
    screen = await mount(<ReplyVoices />);

    await press("New voice");
    expect(button("Create voice").disabled).toBe(true);
  });
});
