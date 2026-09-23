// @vitest-environment jsdom
/**
 * The monitor screens' shared parts, driven through the DOM. US-353.
 *
 * What is asserted is the contract with the page: each part shows the rows it
 * is handed, calls back and never fetches, and carries the options where the
 * two products differ. The sentences are pinned in `monitor.test.ts`; the
 * requests are each application's monitor page test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeadSources } from "./LeadSources.js";
import { MonitorHistory } from "./MonitorHistory.js";
import { MonitorStatus } from "./MonitorStatus.js";
import type { Monitor } from "./monitor.js";
import type { LeadBreakdown, LeadGroup } from "./monitor-stats.js";
import { QueryPerformance } from "./QueryPerformance.js";
import { pollEntry, stageEntry } from "./testing/activity.js";
import { button, mount, type Screen, settle } from "./testing/harness.js";
import { monitor } from "./testing/monitors.js";

let screen: Screen;

afterEach(async () => {
  await screen?.unmount();
});

const text = () => screen.container.textContent ?? "";

describe("the status word", () => {
  it("carries its tone, and quiet when the monitor found nothing", async () => {
    screen = await mount(<MonitorStatus label="Found nothing" tone="running" attention />);

    expect(screen.container.querySelector(".monitor-status")?.className).toBe(
      "monitor-status running quiet",
    );
  });
});

describe("the history", () => {
  it("says it is loading until the page hands it entries", async () => {
    screen = await mount(<MonitorHistory entries={null} />);
    expect(text()).toBe("Loading…");
  });

  it("puts a stage under the poll it came from and leaves out deliveries", async () => {
    screen = await mount(
      <MonitorHistory
        entries={[
          stageEntry({ id: "notify-1", stage: "notify", detail: null }),
          stageEntry(),
          pollEntry(),
        ]}
      />,
    );

    const collections = screen.container.querySelectorAll(".activity-collection");
    expect(collections).toHaveLength(1);
    expect(collections[0]?.querySelector(".poll-entry")).not.toBeNull();
    expect(collections[0]?.querySelectorAll(".stage-entry")).toHaveLength(1);
  });

  it("offers older entries only when the page pages, and asks the page for them", async () => {
    const onShowOlder = vi.fn();
    screen = await mount(<MonitorHistory entries={[pollEntry()]} more />);
    expect(text()).not.toContain("Show older");
    await screen.unmount();

    screen = await mount(<MonitorHistory entries={[pollEntry()]} more onShowOlder={onShowOlder} />);
    button("Show older").click();
    expect(onShowOlder).toHaveBeenCalledOnce();
  });

  it("says where the stage record ends when a poll older than it is on screen", async () => {
    screen = await mount(
      <MonitorHistory entries={[pollEntry()]} stagesRecordedSince="2026-03-14T09:00:00.000Z" />,
    );
    expect(screen.container.querySelector(".activity-record-end")).not.toBeNull();
  });

  it("leaves the dollars out of a poll's sentence when told to", async () => {
    screen = await mount(<MonitorHistory entries={[pollEntry()]} sentence={{ spend: false }} />);
    expect(text()).not.toContain("$");
  });
});

describe("what each search input finds", () => {
  const configured = monitor({
    queries: { reddit: ["flaky tests", "manual qa"] },
    subreddits: ["QualityAssurance"],
  }) as unknown as Monitor;
  const row = {
    kind: "query" as const,
    value: "flaky tests",
    posts: 40,
    matches: 3,
    bestScore: 88,
    lastFoundAt: null,
  };

  it("lists every configured input, the ones with no rows too", async () => {
    screen = await mount(<QueryPerformance monitor={configured} rows={[row]} onRetry={() => {}} />);

    const inputs = [...screen.container.querySelectorAll(".query-performance-value")].map(
      (cell) => cell.textContent,
    );
    expect(inputs).toEqual(["flaky tests", "manual qa", "r/QualityAssurance"]);
    expect(text()).toContain("Nothing found yet");
  });

  it("adds the page's note to a row", async () => {
    screen = await mount(
      <QueryPerformance
        monitor={configured}
        rows={[row]}
        onRetry={() => {}}
        note={(found) => (found ? "Never matched" : null)}
      />,
    );
    expect(screen.container.querySelectorAll(".query-performance-verdict")).toHaveLength(1);
  });

  it("shows the refusal with a way to ask again", async () => {
    const onRetry = vi.fn();
    screen = await mount(
      <QueryPerformance monitor={configured} rows={null} error="No." onRetry={onRetry} />,
    );
    button("Try again").click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("where the leads come from", () => {
  const group = (overrides: Partial<LeadGroup>): LeadGroup => ({
    value: "reddit",
    source: null,
    matches: 5,
    averageScore: 71,
    bestScore: 92,
    strong: 3,
    ...overrides,
  });
  const breakdown: LeadBreakdown = {
    platforms: [group({})],
    channels: [group({ value: "SaaS", source: "reddit" })],
    kinds: [group({ value: "reply" })],
    intents: [group({ value: "alternative_search" })],
  };

  it("offers three groups unless the page names more", async () => {
    screen = await mount(<LeadSources breakdown={breakdown} onRetry={() => {}} />);
    const labels = () =>
      [...screen.container.querySelectorAll(".lead-breakdown-switch button")].map(
        (node) => node.textContent,
      );
    expect(labels()).toEqual(["Platforms", "Channels", "Intent"]);
    await screen.unmount();

    screen = await mount(
      <LeadSources
        breakdown={breakdown}
        onRetry={() => {}}
        dimensions={["platforms", "channels", "kinds", "intents"]}
      />,
    );
    expect(labels()).toContain("Posts vs. comments");
  });

  it("names an intent from the API's label when it sends one, and from its own words when not", async () => {
    screen = await mount(<LeadSources breakdown={breakdown} onRetry={() => {}} />);
    button("Intent").click();
    await settle();
    expect(text()).toContain("Looking for alternatives");
    await screen.unmount();

    const labelled = { ...breakdown, intents: [group({ value: "x", label: "The API's name" })] };
    screen = await mount(<LeadSources breakdown={labelled} onRetry={() => {}} />);
    button("Intent").click();
    await settle();
    expect(text()).toContain("The API's name");
  });

  it("says there is nothing yet when no offered group has a match", async () => {
    const empty: LeadBreakdown = { platforms: [], channels: [], kinds: [], intents: [] };
    screen = await mount(<LeadSources breakdown={empty} onRetry={() => {}} />);
    expect(text()).toContain("No matches yet");
  });
});
