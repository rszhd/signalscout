/**
 * The turn rule, without a database. US-289.
 *
 * Written first. The cases are the ticket's sentences: over a day it
 * spends the credits an hour exactly; the first platform may take the
 * balance negative and a later one may not; the order is the monitor's
 * from the cursor; the balance never exceeds one full turn.
 */
import { describe, expect, it } from "vitest";
import { nextTurn, platformWeight, type RotationState } from "./rotation.js";

function state(overrides: Partial<RotationState> = {}): RotationState {
  return {
    sources: ["reddit", "x", "youtube", "tiktok"],
    searchesOn: () => 1,
    weights: {},
    creditsPerHour: 1,
    balance: 0,
    cursor: 0,
    ...overrides,
  };
}

/** A day of polls, one an hour, returning what each ran. */
function day(start: RotationState, hours = 24): string[][] {
  const ran: string[][] = [];
  let current = start;
  for (let hour = 0; hour < hours; hour += 1) {
    const turn = nextTurn(current);
    ran.push([...turn.sources]);
    current = { ...current, balance: turn.balance, cursor: turn.cursor };
  }
  return ran;
}

describe("a monitor's platforms taking turns", () => {
  it("runs one platform an hour at one credit an hour, in the monitor's order, and round again", () => {
    const ran = day(state(), 5);
    expect(ran).toEqual([["reddit"], ["x"], ["youtube"], ["tiktok"], ["reddit"]]);
  });

  it("spends exactly the credits an hour over a day, whatever the shapes", () => {
    const shapes: RotationState[] = [
      state(),
      state({ creditsPerHour: 4, searchesOn: () => 3 }),
      state({
        sources: ["reddit", "linkedin", "x"],
        weights: { linkedin: 5 },
        creditsPerHour: 4,
        searchesOn: (source) => (source === "linkedin" ? 2 : 4),
      }),
      state({ sources: ["reddit"], searchesOn: () => 8, creditsPerHour: 1 }),
    ];

    for (const shape of shapes) {
      const spent = day(shape, 240)
        .flat()
        .reduce(
          (total, source) =>
            total + platformWeight(source, shape.searchesOn(source), shape.weights),
          0,
        );
      // Ten days: within one full turn of the credits, which is the balance's
      // own bound.
      const turn = shape.sources.reduce(
        (total, source) => total + platformWeight(source, shape.searchesOn(source), shape.weights),
        0,
      );
      expect(Math.abs(spent - 240 * shape.creditsPerHour)).toBeLessThanOrEqual(turn);
    }
  });

  it("lets the first platform take the balance negative, and repays it before the next", () => {
    // LinkedIn with one search weighs five against one credit an hour: it
    // runs, then waits four polls while the balance climbs back.
    const linkedin = state({ sources: ["linkedin", "reddit"], weights: { linkedin: 5 } });

    expect(day(linkedin, 8)).toEqual([["linkedin"], [], [], [], [], ["reddit"], ["linkedin"], []]);
  });

  it("runs a later platform only when the balance covers it", () => {
    // Four credits an hour, three platforms of three, two and two searches:
    // reddit and x fit the first hour (five); youtube would need two of the
    // remaining minus one, so it waits for the next hour's credits.
    const searches: Record<string, number> = { reddit: 3, x: 2, youtube: 2 };
    const shape = state({
      sources: ["reddit", "x", "youtube"],
      searchesOn: (source) => searches[source] ?? 0,
      creditsPerHour: 4,
    });

    const [first, second] = day(shape, 2);
    expect(first).toEqual(["reddit"]);
    expect(second).toEqual(["x", "youtube"]);
  });

  it("caps the balance at one full turn, so a paused week is one turn on resume", () => {
    const turn = nextTurn(state({ balance: 1_000 }));
    // Four platforms of one: the whole turn ran and nothing is banked.
    expect(turn.sources).toEqual(["reddit", "x", "youtube", "tiktok"]);
    expect(turn.balance).toBe(0);
  });

  it("starts from the cursor, and wraps it", () => {
    const turn = nextTurn(state({ cursor: 3 }));
    expect(turn.sources).toEqual(["tiktok"]);
    expect(turn.cursor).toBe(0);

    // A cursor past the end — a platform was removed — is read modulo.
    expect(nextTurn(state({ cursor: 9 })).sources).toEqual(["x"]);
  });

  it("runs every platform in one poll when the credits cover the whole turn", () => {
    const turn = nextTurn(state({ creditsPerHour: 10 }));
    expect(turn.sources).toEqual(["reddit", "x", "youtube", "tiktok"]);
  });

  it("weighs a platform with no searches as one, so a channel-only Reddit still turns", () => {
    expect(platformWeight("reddit", 0, {})).toBe(1);
    expect(platformWeight("linkedin", 2, { linkedin: 5 })).toBe(10);
  });

  it("runs nothing for a monitor with no platforms", () => {
    expect(nextTurn(state({ sources: [] })).sources).toEqual([]);
  });
});
