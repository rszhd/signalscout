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

/**
 * The default key's answer for a job, as the server computes it. US-083.
 *
 * A view built by hand would otherwise carry a fallback that disagrees with
 * the key list beside it, and the screen would be asserted against a state the
 * server cannot produce.
 */
function fallbackFor(keys: { provider?: string | null; name: string; id: string }[]) {
  const chosen = keys.find((one) => (one as { isDefault?: boolean }).isDefault);

  if (!chosen) {
    return {
      source: "instance" as const,
      provider: "anthropic",
      model: "claude-haiku-4-5",
      hasKey: true,
      keyName: null,
      keyId: null,
    };
  }

  return {
    source: "key" as const,
    provider: chosen.provider ?? "anthropic",
    model: chosen.provider === "openai" ? "gpt-5.6-terra" : "claude-sonnet-5",
    hasKey: true,
    keyName: chosen.name,
    keyId: chosen.id,
  };
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
    testModels: { openai: "gpt-5.6-terra", anthropic: "claude-sonnet-5" },
    keys,
    tasks: [
      {
        task: "classify",
        title: "Scoring posts",
        what: "Reads a post and scores it against the monitor.",
        note: "The most expensive call this product makes.",
        providers: ["openai", "anthropic"],
        instance: { provider: "anthropic", model: "claude-haiku-4-5", hasKey: true },
        fallback: fallbackFor(keys as { provider?: string | null; name: string; id: string }[]),
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
    isDefault: false,
  };

  /** The same key, marked as the one every untouched job follows. US-083. */
  const defaultKey = { ...storedKey, isDefault: true };

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
            isDefault: false,
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Unlabelled",
            provider: null,
            hint: "••••klmn",
            isDefault: false,
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
    await act(async () => button("Test and add key").click());
    await settle();

    const [url, init] = fetched.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/models/keys");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      name: "My OpenAI key",
      apiKey: "sk-mine",
      // The key is tested before it is stored, and a test has to call
      // something. US-087.
      model: "claude-haiku-4-5",
    });
  });

  /**
   * US-087. A provider key has been tested before it was stored since US-023,
   * and a model key was not. These are the cases that hold the reversal on the
   * screen: the person sees what will be called, and reads the refusal.
   */
  describe("adding a key tests it first", () => {
    async function openTheKeyDialog() {
      screen = await mount(<Models />);
      await act(async () => button("Close Scoring posts").click());
      await act(async () => button("Add an API key").click());
    }

    it("fills the test model in from the provider, and sends it", async () => {
      await openTheKeyDialog();

      setValue(field("Key name"), "My OpenAI key");
      setValue(select("Key provider"), "openai");
      setValue(field("New API key"), "sk-mine");

      expect(field("Model to test the key with").value).toBe("gpt-5.6-terra");

      await act(async () => button("Test and add key").click());
      await settle();

      const [, init] = fetched.mock.calls.at(-1) as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toMatchObject({
        provider: "openai",
        model: "gpt-5.6-terra",
      });
    });

    it("leaves the model empty for a provider this build cannot name one for", async () => {
      // Ollama runs whatever the machine has pulled, so there is no name to
      // offer and the person types one.
      fetched.mockResolvedValue(json(view({ providers: ["openai", "ollama"] })));
      await openTheKeyDialog();

      setValue(select("Key provider"), "openai");
      setValue(select("Key provider"), "ollama");

      expect(field("Model to test the key with").value).toBe("");
    });

    it("keeps the dialog open on a refusal, with the provider's own sentence", async () => {
      fetched.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST" && String(url) === "/api/models/keys") {
          return new Response(JSON.stringify({ message: "401 Incorrect API key provided." }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        return json(view());
      });
      await openTheKeyDialog();

      const dialog = document.querySelector(
        'dialog[aria-labelledby="add-model-key-title"]',
      ) as HTMLDialogElement;

      setValue(field("Key name"), "A wrong key");
      setValue(field("New API key"), "sk-wrong");
      await act(async () => button("Test and add key").click());
      await settle();

      expect(dialog.open).toBe(true);
      expect(dialog.textContent).toContain("401 Incorrect API key provided.");
      // The typed key is the only copy of it.
      expect(field("New API key").value).toBe("sk-wrong");
    });

    it("says the test costs money, because it does", async () => {
      await openTheKeyDialog();

      const dialog = document.querySelector(
        'dialog[aria-labelledby="add-model-key-title"]',
      ) as HTMLDialogElement;

      expect(dialog.textContent).toContain("tested before it is stored");
      expect(dialog.textContent).toContain("billed");
    });
  });

  /**
   * US-086. Pressing Save is a person saying they are finished with the
   * dialog, and the row underneath is the confirmation.
   */
  describe("a dialog that was saved", () => {
    function jobDialog(): HTMLDialogElement {
      return document.querySelector(
        'dialog[aria-labelledby="job-title-classify"]',
      ) as HTMLDialogElement;
    }

    it("closes when the job is saved", async () => {
      // A fresh response per call: a `Response` body can be read once, and the
      // save reads a second one.
      fetched.mockImplementation(async () => json(view({}, [storedKey])));
      screen = await mount(<Models />);

      expect(jobDialog().open).toBe(true);
      setValue(select("Scoring posts key"), storedKey.id);
      setValue(select("Scoring posts model"), "gpt-5.6-terra");
      await act(async () => button("Save changes").click());
      await settle();

      expect(jobDialog().open).toBe(false);
    });

    it("closes when a key is added", async () => {
      screen = await mount(<Models />);
      const dialog = document.querySelector(
        'dialog[aria-labelledby="add-model-key-title"]',
      ) as HTMLDialogElement;

      await act(async () => button("Close Scoring posts").click());
      await act(async () => button("Add an API key").click());
      setValue(field("Key name"), "My OpenAI key");
      setValue(field("New API key"), "sk-mine");
      await act(async () => button("Test and add key").click());
      await settle();

      expect(dialog.open).toBe(false);
    });

    /**
     * The one case where the person is not finished, and what they typed is
     * the only copy of it.
     */
    it("stays open when the server refuses, with the values that caused it", async () => {
      fetched.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return new Response(JSON.stringify({ message: "That model is retired." }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        return json(view({}, [storedKey]));
      });
      screen = await mount(<Models />);

      setValue(select("Scoring posts key"), storedKey.id);
      setValue(select("Scoring posts model"), "gpt-5.6-terra");
      await act(async () => button("Save changes").click());
      await settle();

      expect(jobDialog().open).toBe(true);
      expect(jobDialog().textContent).toContain("That model is retired.");
      expect(select("Scoring posts model").value).toBe("gpt-5.6-terra");
    });

    it("carries no message over from the last time it was open", async () => {
      fetched.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "DELETE" && String(url).endsWith("/classify")) {
          return json(view({}, [storedKey]));
        }
        return json(view({ keyId: storedKey.id, model: "gpt-5.6-terra" }, [storedKey]));
      });
      screen = await mount(<Models />);

      await act(async () => button("Use instance defaults").click());
      await settle();
      expect(jobDialog().textContent).toContain("Using instance defaults");

      await act(async () => button("Close Scoring posts").click());
      await act(async () => button("Edit Scoring posts").click());
      expect(jobDialog().textContent).not.toContain("Using instance defaults");
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

  /**
   * One pasted key, and the four jobs run. US-083.
   *
   * Through the DOM because the claim is what a person sees: a job nobody has
   * touched has to *say* it is working and on what, or the page reads as
   * unfinished on the account where everything is already right.
   */
  describe("the default key", () => {
    it("marks the default in the list and offers to move it to another", async () => {
      fetched.mockResolvedValue(
        json(
          view({}, [
            defaultKey,
            {
              id: "22222222-2222-4222-8222-222222222222",
              name: "Second",
              provider: "anthropic",
              hint: "••••ghij",
              isDefault: false,
            },
          ]),
        ),
      );
      screen = await mount(<Models />);

      expect(screen.container.textContent).toContain("Default");

      // One button, on the key that is not the default. A key offered the
      // chance to become what it already is reads as a setting that did not take.
      expect(
        [...screen.container.querySelectorAll("button")].filter(
          (one) => one.textContent === "Make default",
        ),
      ).toHaveLength(1);

      await act(async () => button("Make default").click());
      await settle();

      const [url, init] = fetched.mock.calls.at(-1) as [string, RequestInit];
      expect(url).toBe("/api/models/keys/22222222-2222-4222-8222-222222222222/default");
      expect(init.method).toBe("PUT");
    });

    it("says a job with no settings runs on the default key and its model", async () => {
      fetched.mockResolvedValue(json(view({}, [defaultKey])));
      screen = await mount(<Models />);

      // The row a person reads before opening anything.
      expect(screen.container.textContent).toContain("gpt-5.6-terra");
      expect(screen.container.textContent).toContain("default key: My OpenAI key");
      expect(screen.container.textContent).toContain("runs on your default key");
    });

    /**
     * Opening a working job and saving it must not change what it does.
     *
     * The fields start on what the job is running rather than on blanks
     * standing for it — the failure otherwise is silent and expensive: a
     * person opens a card to read it, presses Save, and the job moves back to
     * a deployment key that a hosted account does not have.
     */
    it("opens a following job on what it is already running", async () => {
      fetched.mockResolvedValue(json(view({}, [defaultKey])));
      screen = await mount(<Models />);

      expect(select("Scoring posts key").value).toBe(defaultKey.id);
      expect(select("Scoring posts model").value).toBe("gpt-5.6-terra");
    });

    /**
     * A key on a provider this build can name no model for changes nothing,
     * and the card must not pretend otherwise. On a hosted account there is no
     * machine key underneath, so the honest answer is that the job needs one.
     */
    it("says a following job needs a key when nothing underneath it has one", async () => {
      fetched.mockResolvedValue(
        json(
          view({
            instance: { provider: "anthropic", model: "claude-haiku-4-5", hasKey: false },
            fallback: {
              source: "instance",
              provider: "anthropic",
              model: "claude-haiku-4-5",
              hasKey: false,
              keyName: null,
              keyId: null,
            },
          }),
        ),
      );
      screen = await mount(<Models />);

      expect(screen.container.textContent).toContain("Needs a key");
      expect(screen.container.textContent).not.toContain("claude-haiku-4-5 · this instance");
    });

    it("names the default on the button that hands a job back to it", async () => {
      fetched.mockResolvedValue(
        json(view({ provider: "openai", model: "gpt-5.6-luna" }, [defaultKey])),
      );
      screen = await mount(<Models />);

      await act(async () => button("Follow the default key (My OpenAI key)").click());
      await settle();

      const [url, init] = fetched.mock.calls.at(-1) as [string, RequestInit];
      expect(url).toBe("/api/models/classify");
      expect(init.method).toBe("DELETE");
    });
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
