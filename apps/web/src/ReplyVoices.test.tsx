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

/** What the presets route offers, so a test can say what a person is shown. */
let offeredPresets: { id: string; name: string; instruction: string; why: string }[] = [];

function server(initial: ReturnType<typeof voice>[] = []) {
  const calls: Call[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });

    // The presets route is its own answer. US-065: the page reads it
    // separately, and a stub that returned voices for both would hide whether
    // the page can tell them apart.
    if (method === "GET" && url.includes("/presets")) {
      return Promise.resolve(json({ presets: [...offeredPresets] }));
    }
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

describe("starting from a voice somebody already wrote", () => {
  /**
   * US-065. The empty state used to be a blank box and the words "Create your
   * first reply voice", which is the hardest screen here to answer: a person
   * who has never written an instruction does not know what a good one looks
   * like.
   */
  beforeEach(() => {
    offeredPresets = [
      {
        id: "reddit-regular",
        name: "Reddit regular",
        instruction: "Write the way a regular in this subreddit writes.",
        why: "Subreddits treat a reply that opens with a product as an advertisement.",
      },
    ];
  });

  it("offers them beside the saved list, each with the reason it exists", async () => {
    // A preset somebody does not understand is one they cannot edit sensibly.
    server();
    screen = await mount(<ReplyVoices />);

    const text = screen.container.textContent ?? "";
    expect(text).toContain("Reddit regular");
    expect(text).toContain("treat a reply that opens with a product");
  });

  it("adds one in a single press, because that is what the button says", async () => {
    // The first version only filled the form, which turned "add a few more
    // voices" into a form to complete five times.
    const calls = server();
    screen = await mount(<ReplyVoices />);

    // Queried rather than found by label: the button holds a name, a reason
    // and the word Add, so its text is all three.
    const preset = screen.container.querySelector<HTMLButtonElement>(".reply-voice-presets button");
    preset?.click();
    await settle();

    const created = calls.find(
      (call) => call.method === "POST" && call.url.endsWith("/api/reply-prompts"),
    );

    expect(created?.body).toEqual({
      name: "Reddit regular",
      instruction: "Write the way a regular in this subreddit writes.",
    });
    // And it opens for editing, because a preset is a starting point.
    expect(field("Voice name").value).toBe("Reddit regular");
  });

  it("keeps the blank form working when the presets cannot be read", async () => {
    // Presets are a way to start, not a way to work.
    offeredPresets = [];
    server();
    screen = await mount(<ReplyVoices />);

    expect(screen.container.textContent).toContain("Create your first reply voice");
  });
});

describe("reaching the presets with voices already saved", () => {
  /**
   * The first version put presets only on the empty state, which hid them
   * from the person most likely to want them: somebody who has written one
   * voice and wants a few more. That is how this was asked for.
   */
  beforeEach(() => {
    offeredPresets = [
      {
        id: "reddit-regular",
        name: "Reddit regular",
        instruction: "Write the way a regular in this subreddit writes.",
        why: "Subreddits treat a reply that opens with a product as an advertisement.",
      },
    ];
  });

  it("shows them on arrival, with voices already saved", async () => {
    // The failure this replaced: buried behind New voice, the page said
    // "Saved voices 1" and the five may as well not have shipped.
    server([voice()]);
    screen = await mount(<ReplyVoices />);

    expect(screen.container.querySelector(".reply-voice-presets")).not.toBeNull();
  });

  it("stops offering one that is already saved", async () => {
    // Offering it again would only produce the duplicate-name refusal.
    server([voice({ name: "Reddit regular" })]);
    screen = await mount(<ReplyVoices />);

    expect(screen.container.querySelector(".reply-voice-presets")).toBeNull();
  });
});
