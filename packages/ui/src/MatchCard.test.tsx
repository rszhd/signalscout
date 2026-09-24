// @vitest-environment jsdom
/**
 * One row of the inbox list, driven through the DOM. US-396.
 *
 * What is asserted is the mark a person scans the list for: whether they
 * already answered a match, said beside whether they kept it or judged it good.
 */
import { afterEach, describe, expect, it } from "vitest";
import { MatchCard } from "./MatchCard.js";
import type { Match } from "./match.js";
import { mount, type Screen } from "./testing/harness.js";
import { match } from "./testing/matches.js";

let screen: Screen;

afterEach(async () => {
  await screen?.unmount();
});

async function status(row: Match): Promise<string> {
  screen = await mount(<MatchCard match={row} selected={false} onSelect={() => undefined} />);
  return screen.container.querySelector(".match-list-status")?.textContent ?? "";
}

describe("the status on a card", () => {
  it("says a match was replied to", async () => {
    expect(await status(match({ replied: true }))).toBe("Replied");
  });

  it("says replied beside saved, rather than instead of it", async () => {
    expect(await status(match({ replied: true, saved: true }))).toBe("Replied · Saved");
  });

  it("says nothing about a reply the API did not report", async () => {
    const { replied: _, ...older } = match({ verdict: "good" });

    expect(await status(older)).toBe("Good lead");
  });
});
