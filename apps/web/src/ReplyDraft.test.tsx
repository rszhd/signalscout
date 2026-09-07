// @vitest-environment jsdom
/**
 * The draft panel, driven through the DOM a person uses.
 *
 * What this file owns is the promise the screen makes: that nothing is
 * generated until the button is pressed, that the draft is editable, that a
 * saved prompt is actually sent, and that the screen says this product does
 * not post. The prompt's wording and the model's behaviour are asserted in
 * core.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplyDraft } from "./ReplyDraft.js";
import { button, field, json, mount, type Screen, select, settle, setValue } from "./testing.js";

const matchId = "8d2b4a1e-3f5c-4c7a-9e11-2b6d0c4f7a31";

function prompt(overrides: Record<string, unknown> = {}) {
  return {
    id: "1f0f5e0a-0000-4000-8000-000000000001",
    name: "Short and plain",
    instruction: "Write plainly, no exclamation marks.",
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
    ...overrides,
  };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    reply: "Retries hide the flake rather than fix it. [check: whether they use CI at all]",
    uncertainties: ["Whether they are running these in CI"],
    model: "gpt-5.6-terra",
    estimatedCostMicros: 2975,
    ...overrides,
  };
}

let screen: Screen;

function text(): string {
  return screen.container.textContent ?? "";
}

/** Press a button and let its work finish. */
async function press(label: string): Promise<void> {
  button(label).click();
  await settle();
}

/** Every call the panel made, so a test can say what was and was not sent. */
interface Call {
  url: string;
  method: string;
  body: unknown;
}

function server(routes: { prompts?: unknown; draft?: { status: number; body: unknown } }) {
  const calls: Call[] = [];

  const fetchStub = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (url.includes("/api/reply-prompts")) {
      return Promise.resolve(json(routes.prompts ?? { prompts: [] }));
    }

    const answer = routes.draft ?? { status: 200, body: draft() };
    return Promise.resolve(json(answer.body, answer.status));
  });

  vi.spyOn(globalThis, "fetch").mockImplementation(fetchStub as unknown as typeof fetch);
  return { calls };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(async () => {
  await screen?.unmount();
});

describe("nothing is generated until somebody asks", () => {
  it("writes no draft when the panel opens", async () => {
    // A draft costs a model call and a person's reputation. Opening a match is
    // not a request for one.
    const { calls } = server({});
    screen = await mount(<ReplyDraft matchId={matchId} />);

    expect(calls.some((call) => call.url.includes("/draft"))).toBe(false);
  });

  it("asks the model only when the button is pressed", async () => {
    const { calls } = server({});
    screen = await mount(<ReplyDraft matchId={matchId} />);

    await press("Draft reply");

    const drafted = calls.filter((call) => call.url.includes("/draft"));
    expect(drafted).toHaveLength(1);
    expect(drafted[0]?.method).toBe("POST");
  });
});

describe("the draft itself", () => {
  it("arrives editable, because the editing is the point", async () => {
    server({});
    screen = await mount(<ReplyDraft matchId={matchId} />);

    await press("Draft reply");

    const area = screen.container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Draft reply"]',
    );

    expect(area).not.toBeNull();
    expect(area?.value).toContain("Retries hide the flake");
  });

  it("says this product does not post", async () => {
    // PLAN.md puts social publishing on the "not building" list, and a person
    // who thinks this sends is a person surprised in public.
    server({});
    screen = await mount(<ReplyDraft matchId={matchId} />);

    await press("Draft reply");

    expect(text()).toContain("Nothing is posted from here");
  });

  it("lists what the model was unsure of", async () => {
    server({});
    screen = await mount(<ReplyDraft matchId={matchId} />);

    await press("Draft reply");

    expect(text()).toContain("Check before you post");
    expect(text()).toContain("Whether they are running these in CI");
  });

  it("names the model and what the call cost, to four decimal places", async () => {
    // docs/costs.md: a figure rounded to cents cannot be reconciled against
    // anything, and this one is on the person's own key.
    server({});
    screen = await mount(<ReplyDraft matchId={matchId} />);

    await press("Draft reply");

    expect(text()).toContain("gpt-5.6-terra");
    expect(text()).toContain("$0.0030");
  });

  it("says an unpriced model cost an unknown amount rather than nothing", async () => {
    server({ draft: { status: 200, body: draft({ estimatedCostMicros: null }) } });
    screen = await mount(<ReplyDraft matchId={matchId} />);

    await press("Draft reply");

    expect(text()).toContain("an unknown amount");
  });
});

describe("the saved prompts", () => {
  it("offers the ones the account has, and none by default", async () => {
    server({ prompts: { prompts: [prompt()] } });
    screen = await mount(<ReplyDraft matchId={matchId} />);

    expect(text()).toContain("No saved prompt");
    expect(text()).toContain("Short and plain");
  });

  it("sends the chosen one with the draft request", async () => {
    // A prompt that is stored and never sent is the failure nobody notices.
    const saved = prompt();
    const { calls } = server({ prompts: { prompts: [saved] } });
    screen = await mount(<ReplyDraft matchId={matchId} />);

    setValue(select("Saved prompt"), saved.id);
    await settle();
    await press("Draft reply");

    const drafted = calls.find((call) => call.url.includes("/draft"));
    expect(drafted?.body).toEqual({ promptId: saved.id });
  });

  it("sends no prompt when none is chosen", async () => {
    const { calls } = server({ prompts: { prompts: [prompt()] } });
    screen = await mount(<ReplyDraft matchId={matchId} />);

    await press("Draft reply");

    expect(calls.find((call) => call.url.includes("/draft"))?.body).toEqual({ promptId: null });
  });

  it("saves a new one, so a voice can be reused on the next match", async () => {
    const { calls } = server({ prompts: { prompts: [] } });
    screen = await mount(<ReplyDraft matchId={matchId} />);

    await press("Edit prompts");
    setValue(field("Instruction"), "Never use exclamation marks.");
    setValue(field("New prompt name"), "Plain");
    await settle();
    await press("Save as new");

    const created = calls.find(
      (call) => call.url.endsWith("/api/reply-prompts") && call.method === "POST",
    );

    expect(created?.body).toEqual({ name: "Plain", instruction: "Never use exclamation marks." });
  });

  it("will not save a prompt with no name or no instruction", async () => {
    server({ prompts: { prompts: [] } });
    screen = await mount(<ReplyDraft matchId={matchId} />);

    await press("Edit prompts");

    expect(button("Save as new").disabled).toBe(true);
  });

  it("shows the chosen prompt's words, so editing starts from what is saved", async () => {
    const saved = prompt();
    server({ prompts: { prompts: [saved] } });
    screen = await mount(<ReplyDraft matchId={matchId} />);

    setValue(select("Saved prompt"), saved.id);
    await settle();
    await press("Edit prompts");

    const area = screen.container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Instruction"]',
    );

    expect(area?.value).toBe(saved.instruction);
  });

  it("says an instruction cannot override the rules that keep a draft honest", async () => {
    server({ prompts: { prompts: [] } });
    screen = await mount(<ReplyDraft matchId={matchId} />);

    await press("Edit prompts");

    expect(text()).toContain("cannot make the draft open with your product");
  });
});

describe("when the model will not answer", () => {
  it("shows the server's own sentence rather than a generic failure", async () => {
    // A model that declines to write a sales reply is telling the person
    // something, and "something went wrong" throws that away.
    server({
      draft: {
        status: 422,
        body: { message: "gpt-5.6-terra did not write a usable draft. It refused." },
      },
    });
    screen = await mount(<ReplyDraft matchId={matchId} />);

    await press("Draft reply");

    expect(text()).toContain("It refused.");
  });

  it("still lets somebody draft when the prompt list will not load", async () => {
    // A prompt list is a convenience. Losing it must not take the button away.
    vi.spyOn(globalThis, "fetch").mockImplementation(((input: unknown) => {
      const url = String(input);
      if (url.includes("/api/reply-prompts")) return Promise.resolve(json({ message: "no" }, 500));
      return Promise.resolve(json(draft()));
    }) as unknown as typeof fetch);

    screen = await mount(<ReplyDraft matchId={matchId} />);

    await press("Draft reply");

    expect(text()).toContain("Retries hide the flake");
  });
});
