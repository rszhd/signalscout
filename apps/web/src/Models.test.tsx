// @vitest-environment jsdom
/**
 * The Models screen, through the DOM. US-068, US-079.
 *
 * The claims are the ones a person's money depends on. An empty field means
 * "use this instance's", and the screen has to say what that is or the empty
 * state is a mystery. A key is added once, above the jobs, and each job picks
 * from that list — so what this file owns is that the picker offers the
 * account's keys, that a save carries the choice, and that adding a key posts
 * to the key route and nowhere else.
 */
import { act, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Models } from "./Models.js";
import {
  button,
  field,
  json,
  mount as mountScreen,
  type Screen,
  select,
  settle,
  setValue,
} from "./testing.js";

async function mount(element: ReactElement) {
  const screen = await mountScreen(element);
  await act(async () => button("Edit Scoring posts").click());
  return screen;
}

function view(overrides: Record<string, unknown> = {}, keys: unknown[] = []) {
  return {
    canStore: true,
    storeBlocker: null,
    pricedModels: {
      anthropic: ["claude-haiku-4-5", "claude-sonnet-5"],
      openai: ["gpt-5.6-luna", "gpt-5.6-terra"],
    },
    embeddingModels: { openai: "text-embedding-3-small" },
    keys,
    tasks: [
      {
        task: "classify",
        title: "Scoring posts",
        what: "Reads a post and scores it against the monitor.",
        note: "The most expensive call this product makes.",
        providers: ["openai", "anthropic"],
        instance: { provider: "anthropic", model: "claude-haiku-4-5", hasKey: true },
        provider: null,
        model: null,
        baseUrl: null,
        inputPriceMicros: null,
        outputPriceMicros: null,
        keyId: null,
        ...overrides,
      },
    ],
  };
}

describe("the models screen", () => {
  let screen: Screen;
  let fetched: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom has no dialog top layer; browser checks cover native focus and Escape.
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    });
    fetched = vi.fn(async () => json(view()));
    vi.stubGlobal("fetch", fetched);
  });

  afterEach(async () => {
    await screen?.unmount();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });

  it("opens job settings in a modal and closes without saving", async () => {
    screen = await mountScreen(<Models />);
    const dialog = document.querySelector(
      'dialog[aria-labelledby="job-title-classify"]',
    ) as HTMLDialogElement;
    expect(dialog.open).toBe(false);
    await act(async () => button("Edit Scoring posts").click());
    expect(dialog.open).toBe(true);
    setValue(select("Scoring posts model"), "claude-sonnet-5");
    await act(async () => button("Close Scoring posts").click());
    expect(dialog.open).toBe(false);
    expect(fetched).toHaveBeenCalledTimes(1);
    await act(async () => button("Edit Scoring posts").click());
    expect(select("Scoring posts model").value).toBe("claude-sonnet-5");
  });

  it("opens the add-key form in its own modal", async () => {
    screen = await mountScreen(<Models />);
    const dialog = document.querySelector(
      'dialog[aria-labelledby="add-model-key-title"]',
    ) as HTMLDialogElement;
    expect(dialog.open).toBe(false);
    await act(async () => button("Add an API key").click());
    expect(dialog.open).toBe(true);
    await act(async () => button("Close API key dialog").click());
    expect(dialog.open).toBe(false);
  });

  it("says what an empty field falls back to", async () => {
    screen = await mount(<Models />);

    // The list names providers and not settings, so the value is the one the
    // job will run on rather than a blank standing for it.
    expect(select("Scoring posts provider").value).toBe("anthropic");
    expect(screen.container.textContent).toContain("This instance runs on Anthropic.");
    expect(select("Scoring posts model").selectedOptions[0]?.textContent).toBe(
      "Instance default · claude-haiku-4-5",
    );
    // And the key it would use, which on an account with none is the machine's.
    expect(select("Scoring posts key").value).toBe("");
    expect(screen.container.textContent).toContain("This instance's key");
  });

  it("carries the reason a triage model should be the cheap one", async () => {
    screen = await mount(<Models />);

    // The measurement, not just the field. Somebody picking a triage model
    // without it picks the wrong one, and US-030 is what measured that.
    expect(screen.container.textContent).toContain("The most expensive call this product makes.");
  });

  const storedKey = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "My OpenAI key",
    provider: "openai",
    hint: "••••abcd",
  };

  it("lists the account's keys and never a value", async () => {
    fetched.mockResolvedValue(json(view({}, [storedKey])));
    screen = await mount(<Models />);

    expect(screen.container.textContent).toContain("My OpenAI key");
    expect(screen.container.textContent).toContain("••••abcd");
    // The picker offers it, and the instance's key stays the first answer.
    expect(select("Scoring posts key").value).toBe("");
    expect(screen.container.textContent).toContain("This instance's key");
  });

  it("sends the chosen key with the job", async () => {
    fetched.mockResolvedValue(json(view({}, [storedKey])));
    screen = await mount(<Models />);

    setValue(select("Scoring posts key"), storedKey.id);
    // The key moves the job to OpenAI, so it needs an OpenAI model name.
    setValue(select("Scoring posts model"), "gpt-5.6-terra");
    await act(async () => button("Save changes").click());
    await settle();

    const [url, init] = fetched.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/models/classify");
    expect(JSON.parse(String(init.body)).keyId).toBe(storedKey.id);
  });

  /**
   * The silent one. The form posts every field on every save, so the choice
   * has to be sent on every save too — and "the instance's key" is a choice,
   * which is why it is null rather than absent.
   */
  it("sends null when the job is put back on the instance's key", async () => {
    fetched.mockResolvedValue(json(view({ keyId: storedKey.id }, [storedKey])));
    screen = await mount(<Models />);

    expect(select("Scoring posts key").value).toBe(storedKey.id);

    setValue(select("Scoring posts key"), "");
    await act(async () => button("Save changes").click());
    await settle();

    const [, init] = fetched.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(String(init.body)).keyId).toBeNull();
  });

  it("stops asking for a provider once the key names one", async () => {
    fetched.mockResolvedValue(json(view({}, [storedKey])));
    screen = await mount(<Models />);

    // Before: the job has no key, so the question stands.
    expect(select("Scoring posts provider").value).toBe("anthropic");

    setValue(select("Scoring posts key"), storedKey.id);
    await settle();

    // After: one answer, shown rather than asked.
    expect(() => select("Scoring posts provider")).toThrow();
    expect(screen.container.textContent).toContain("From the key you chose");
  });

  /**
   * A card offering every model this build knows offers most of them to the
   * wrong provider, and that pairing fails every call.
   */
  it("offers only the models of the provider the job runs on", async () => {
    fetched.mockResolvedValue(json(view({}, [storedKey])));
    screen = await mount(<Models />);

    const listed = () =>
      [...document.querySelectorAll("#models-classify option")].map(
        (option) => (option as HTMLOptionElement).value,
      );

    // On the instance's Anthropic to begin with.
    expect(listed()).toEqual(["claude-haiku-4-5", "claude-sonnet-5"]);

    // The key names OpenAI, so the job does, so the list does.
    setValue(select("Scoring posts key"), storedKey.id);
    await settle();

    expect(listed()).toEqual(["gpt-5.6-luna", "gpt-5.6-terra"]);
  });

  it("says so when the instance holds no key, rather than offering one", async () => {
    fetched.mockResolvedValue(
      json(
        view({ instance: { provider: "anthropic", model: "claude-haiku-4-5", hasKey: false } }, [
          storedKey,
        ]),
      ),
    );
    screen = await mount(<Models />);

    expect(screen.container.textContent).toContain("No key — this job cannot run");
    expect(screen.container.textContent).toContain("This instance has no Anthropic key");
    expect(screen.container.textContent).not.toContain("This instance's key");
  });

  /**
   * A key the job cannot use is a refusal offered as a choice, and the person
   * cannot fix it from this card.
   */
  it("offers only the keys this job's providers can use", async () => {
    fetched.mockResolvedValue(
      json(
        view({ providers: ["openai", "anthropic"] }, [
          storedKey,
          {
            id: "22222222-2222-4222-8222-222222222222",
            name: "A Google key",
            provider: "google",
            hint: "••••ghij",
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Unlabelled",
            provider: null,
            hint: "••••klmn",
          },
        ]),
      ),
    );
    screen = await mount(<Models />);

    const offered = [...select("Scoring posts key").options].map((one) => one.textContent);

    expect(offered.join(" ")).toContain("My OpenAI key");
    // Named for a provider this job cannot run on.
    expect(offered.join(" ")).not.toContain("A Google key");
    // Named for none, so nobody said it does not belong here.
    expect(offered.join(" ")).toContain("Unlabelled");
  });

  /**
   * The provider follows the key both ways, and the model follows the
   * provider. A leftover from the previous choice fails every call.
   */
  it("puts the provider back to the instance's when the instance key is chosen", async () => {
    fetched.mockResolvedValue(json(view({}, [storedKey])));
    screen = await mount(<Models />);

    setValue(select("Scoring posts key"), storedKey.id);
    setValue(select("Scoring posts model"), "gpt-5.6-terra");
    await settle();

    expect(screen.container.textContent).toContain("From the key you chose");

    // Back to the instance's key: the provider goes back with it, and the
    // OpenAI model does not stay behind on an Anthropic job.
    setValue(select("Scoring posts key"), "");
    await settle();

    expect(select("Scoring posts provider").value).toBe("anthropic");
    expect(select("Scoring posts model").value).toBe("");
  });

  /**
   * `claude-haiku-4-5` is not a name OpenAI answers to. A job moved to another
   * provider has no model until somebody names one, and offering the
   * instance's would be a guaranteed failure printed as a setting.
   */
  it("will not save a job on another provider until it has a model of its own", async () => {
    fetched.mockResolvedValue(json(view({}, [storedKey])));
    screen = await mount(<Models />);

    setValue(select("Scoring posts key"), storedKey.id);
    await settle();

    expect(button("Save changes").disabled).toBe(true);
    expect(() => button("Test key")).toThrow();
    expect(screen.container.textContent).toContain("so this job needs one of its own");

    setValue(select("Scoring posts model"), "gpt-5.6-terra");
    await settle();

    expect(button("Save changes").disabled).toBe(false);
  });

  /**
   * The Test button. US-080.
   *
   * It spends money, so it appears only when there is something to test: a
   * saved key and a model. Both halves are the point — a test with no key
   * would test the instance's, which is not what the button says.
   */
  it("offers a test as soon as a key is picked, before anything is saved", async () => {
    // Nothing saved and nothing picked: there is nothing to test.
    fetched.mockResolvedValue(json(view({ model: null, keyId: null }, [storedKey])));
    screen = await mount(<Models />);

    expect(() => button("Test key")).toThrow();

    // Picked on screen, saved nowhere. With a model, the button is there.
    setValue(select("Scoring posts key"), storedKey.id);
    setValue(select("Scoring posts model"), "gpt-5.6-terra");
    await settle();

    expect(button("Test key")).toBeTruthy();
  });

  it("says what came back, and what it cost", async () => {
    fetched.mockResolvedValue(json(view({ model: null, keyId: null }, [storedKey])));
    screen = await mount(<Models />);

    // Both halves typed and picked, and neither saved.
    setValue(select("Scoring posts key"), storedKey.id);
    setValue(select("Scoring posts model"), "gpt-5.6-terra");
    await settle();

    fetched.mockResolvedValue(
      json({
        status: "ok",
        provider: "openai",
        model: "gpt-5.6-terra",
        latencyMs: 640,
        costMicros: 41,
        error: null,
      }),
    );

    await act(async () => button("Test key").click());
    await settle();

    const [url, init] = fetched.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/models/classify/test");
    expect(init.method).toBe("POST");
    // What is on the screen, not what the server holds.
    expect(JSON.parse(String(init.body))).toMatchObject({
      keyId: storedKey.id,
      model: "gpt-5.6-terra",
      provider: "openai",
    });
    expect(screen.container.textContent).toContain("OpenAI answered as gpt-5.6-terra in 0.6 s");
  });

  it("shows the provider's own sentence when the test fails", async () => {
    fetched.mockResolvedValue(
      json(view({ model: "gpt-5.6-terra", keyId: storedKey.id }, [storedKey])),
    );
    screen = await mount(<Models />);

    fetched.mockResolvedValue(
      json({
        status: "failed",
        provider: "openai",
        model: "gpt-5.6-terra",
        latencyMs: 210,
        costMicros: null,
        error: "401 Incorrect API key provided.",
      }),
    );

    await act(async () => button("Test key").click());
    await settle();

    // The provider's words, not ours: they are what a person can act on.
    expect(screen.container.textContent).toContain("401 Incorrect API key provided.");
  });

  it("saves a custom model entered through the explicit custom option", async () => {
    screen = await mount(<Models />);
    setValue(select("Scoring posts model"), "__custom__");
    await settle();
    setValue(field("Scoring posts custom model"), "my-private-model");
    await act(async () => button("Save changes").click());
    const [, init] = fetched.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(String(init.body)).model).toBe("my-private-model");
  });

  it("keeps a saved unlisted model editable and returns to listed models", async () => {
    fetched.mockResolvedValue(json(view({ model: "my-private-model" })));
    screen = await mount(<Models />);
    expect(field("Scoring posts custom model").value).toBe("my-private-model");
    setValue(select("Scoring posts model"), "claude-sonnet-5");
    await settle();
    expect(() => field("Scoring posts custom model")).toThrow();
    await act(async () => button("Save changes").click());
    const [, init] = fetched.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(String(init.body)).model).toBe("claude-sonnet-5");
  });

  it("adds a key to the account rather than to a job", async () => {
    screen = await mount(<Models />);

    await act(async () => button("Close Scoring posts").click());
    await act(async () => button("Add an API key").click());
    setValue(field("Key name"), "My OpenAI key");
    setValue(field("New API key"), "sk-mine");
    await act(async () => button("Add key").click());
    await settle();

    const [url, init] = fetched.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/models/keys");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      name: "My OpenAI key",
      apiKey: "sk-mine",
    });
  });

  it("removes a key on its own row", async () => {
    fetched.mockResolvedValue(json(view({}, [storedKey])));
    screen = await mount(<Models />);

    await act(async () => button("Remove").click());
    await settle();

    const [url, init] = fetched.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe(`/api/models/keys/${storedKey.id}`);
    expect(init.method).toBe("DELETE");
  });

  it("offers the way back to the instance's settings only when there is one", async () => {
    screen = await mount(<Models />);
    expect(() => button("Use instance defaults")).toThrow();

    await screen.unmount();
    fetched.mockResolvedValue(json(view({ provider: "openai" })));
    screen = await mount(<Models />);

    await act(async () => button("Use instance defaults").click());
    await settle();

    // The last call, because the remount above made a second GET first.
    const [url, init] = fetched.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/models/classify");
    expect(init.method).toBe("DELETE");
  });

  /**
   * Where signup is open the instance's keys are nobody's to spend, so there
   * is nothing to hand a job back to. A button offering that would offer a job
   * that cannot run and call it a default.
   */
  it("offers no way back to the instance when the instance has no key", async () => {
    fetched.mockResolvedValue(
      json(
        view(
          {
            provider: "openai",
            model: "gpt-5.6-terra",
            keyId: storedKey.id,
            instance: { provider: "anthropic", model: "claude-haiku-4-5", hasKey: false },
          },
          [storedKey],
        ),
      ),
    );
    screen = await mount(<Models />);

    expect(() => button("Use instance defaults")).toThrow();
    // And the section says so, rather than promising a fallback there is not.
    expect(screen.container.textContent).toContain("This instance holds no keys of its own");
  });

  it("says so when the instance cannot store a key at all", async () => {
    fetched.mockResolvedValue(
      json({ ...view(), canStore: false, storeBlocker: "Set ENCRYPTION_KEY and restart." }),
    );
    screen = await mount(<Models />);

    expect(screen.container.textContent).toContain("Set ENCRYPTION_KEY and restart.");
    expect(field("New API key").disabled).toBe(true);
  });
});
