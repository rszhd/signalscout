/**
 * The turn rule, without a database. US-289.
 *
 * Written first. The cases are the ticket's sentences: over a day it
 * spends the credits an hour exactly; the first unit may take the balance
 * negative and a later one may not; the order is the monitor's from the
 * cursor; the balance never exceeds one full turn; a search is a unit, a
 * platform's channels are one, and a platform with four searches turns
 * four times.
 */
import { describe, expect, it } from "vitest";
import { nextTurn, type RotationState, type Unit, unitsOf, unitWeight } from "./rotation.js";

const one = (source: string, query = "q"): Unit => ({ source, query });

function state(overrides: Partial<RotationState> = {}): RotationState {
  return {
    units: [one("reddit"), one("x"), one("youtube"), one("tiktok")],
    weights: {},
    creditsPerHour: 1,
    balance: 0,
    cursor: 0,
    ...overrides,
  };
}

/** A day of polls, one an hour, returning what each ran as "source:query". */
function day(start: RotationState, hours = 24): string[][] {
  const ran: string[][] = [];
  let current = start;
  for (let hour = 0; hour < hours; hour += 1) {
    const turn = nextTurn(current);
    ran.push(turn.units.map((unit) => `${unit.source}:${unit.query}`));
    current = { ...current, balance: turn.balance, cursor: turn.cursor };
  }
  return ran;
}

describe("a monitor's searches taking turns", () => {
  it("runs one unit an hour at one credit an hour, in the monitor's order, and round again", () => {
    expect(day(state(), 5)).toEqual([
      ["reddit:q"],
      ["x:q"],
      ["youtube:q"],
      ["tiktok:q"],
      ["reddit:q"],
    ]);
  });

  it("turns four searches on one platform one at a time", () => {
    const units = ["a", "b", "c", "d"].map((query) => one("reddit", query));
    expect(day(state({ units }), 5)).toEqual([
      ["reddit:a"],
      ["reddit:b"],
      ["reddit:c"],
      ["reddit:d"],
      ["reddit:a"],
    ]);
  });

  it("spends exactly the credits an hour over a day, whatever the shapes", () => {
    const shapes: RotationState[] = [
      state(),
      state({
        creditsPerHour: 4,
        units: ["a", "b", "c"].flatMap((q) => [one("reddit", q), one("x", q)]),
      }),
      state({
        units: [one("reddit", "a"), one("linkedin", "a"), one("linkedin", "b"), one("x", "a")],
        weights: { linkedin: 5 },
        creditsPerHour: 4,
      }),
      state({
        units: Array.from({ length: 8 }, (_, i) => one("reddit", `q${i}`)),
        creditsPerHour: 1,
      }),
    ];

    for (const shape of shapes) {
      const cost = (key: string) => {
        const [source, query] = key.split(":");
        return unitWeight({ source: source as string, query: query as string }, shape.weights);
      };
      const spent = day(shape, 240)
        .flat()
        .reduce((total, key) => total + cost(key), 0);
      // Ten days: within one full turn of the credits, which is the balance's
      // own bound.
      const turn = shape.units.reduce((total, unit) => total + unitWeight(unit, shape.weights), 0);
      expect(Math.abs(spent - 240 * shape.creditsPerHour)).toBeLessThanOrEqual(turn);
    }
  });

  it("lets the first unit take the balance negative, and repays it before the next", () => {
    // A LinkedIn search weighs five against one credit an hour: it runs,
    // then waits four polls while the balance climbs back.
    const linkedin = state({ units: [one("linkedin"), one("reddit")], weights: { linkedin: 5 } });

    expect(day(linkedin, 8)).toEqual([
      ["linkedin:q"],
      [],
      [],
      [],
      [],
      ["reddit:q"],
      ["linkedin:q"],
      [],
    ]);
  });

  it("runs a later unit only when the balance covers it", () => {
    // Two credits an hour, three units of five, one and one: the five runs
    // first and takes the balance to minus three; the ones wait.
    const shape = state({
      units: [one("linkedin"), one("reddit"), one("x")],
      weights: { linkedin: 5 },
      creditsPerHour: 2,
    });

    expect(day(shape, 4)).toEqual([["linkedin:q"], [], ["reddit:q"], ["x:q"]]);
  });

  it("caps the balance at one full turn, so a paused week is one turn on resume", () => {
    const turn = nextTurn(state({ balance: 1_000 }));
    // Four units of one: the whole turn ran and nothing is banked.
    expect(turn.units).toHaveLength(4);
    expect(turn.balance).toBe(0);
  });

  it("starts from the cursor, and wraps it", () => {
    const turn = nextTurn(state({ cursor: 3 }));
    expect(turn.units).toEqual([one("tiktok")]);
    expect(turn.cursor).toBe(0);

    // A cursor past the end — a search was removed — is read modulo.
    expect(nextTurn(state({ cursor: 9 })).units).toEqual([one("x")]);
  });

  it("runs every unit in one poll when the credits cover the whole turn", () => {
    expect(nextTurn(state({ creditsPerHour: 10 })).units).toHaveLength(4);
  });

  /**
   * The first poll runs the whole turn, charged. US-291.
   *
   * The trial's shape: four searches at a sixth of a credit an hour. Before
   * this the first poll ran one search and the person waited a day to see
   * the other three; now they see all four in the first minute and the
   * next turn comes when the balance is repaid. The day's spend is the
   * same four credits.
   */
  describe("on a monitor's first poll", () => {
    it("runs every unit whatever the balance, and charges them all", () => {
      const turn = nextTurn(state({ creditsPerHour: 0.167, first: true }));

      expect(turn.units.map((unit) => unit.source)).toEqual(["reddit", "x", "youtube", "tiktok"]);
      expect(turn.balance).toBeCloseTo(0.167 - 4, 3);
      expect(turn.cursor).toBe(0);
    });

    it("runs everything now, then nothing until the balance is repaid, at the same day's spend", () => {
      const first = nextTurn(state({ creditsPerHour: 0.167, first: true }));
      const rest = day({ ...state({ creditsPerHour: 0.167 }), balance: first.balance }, 23);

      expect(rest.slice(0, 22).every((ran) => ran.length === 0)).toBe(true);
      expect(rest[22]).toEqual(["reddit:q"]);
      // Five in the first 24 polls, the same count the turn-by-turn rule
      // reaches in 24 polls: the spend is front-loaded, not larger.
      expect(first.units.length + rest.flat().length).toBe(5);
    });

    it("weighs the turn, and starts from the cursor", () => {
      const turn = nextTurn(
        state({
          units: [one("x"), one("linkedin")],
          weights: { linkedin: 5 },
          cursor: 1,
          first: true,
        }),
      );

      expect(turn.units.map((unit) => unit.source)).toEqual(["linkedin", "x"]);
      expect(turn.balance).toBeCloseTo(1 - 6, 3);
      expect(turn.cursor).toBe(1);
    });

    it("changes nothing for a poll that is not the first", () => {
      expect(nextTurn(state({ first: false }))).toEqual(nextTurn(state()));
    });
  });

  it("lists a monitor's units in its order, with a channels unit where it browses some", () => {
    const queries: Record<string, string[]> = { reddit: ["a", "b"], x: ["c"] };
    const units = unitsOf(
      ["reddit", "x"],
      (source) => queries[source] ?? [],
      (source) => (source === "reddit" ? ["SaaS"] : []),
    );
    expect(units).toEqual([
      one("reddit", "a"),
      one("reddit", "b"),
      { source: "reddit", query: "" },
      one("x", "c"),
    ]);
    expect(unitWeight({ source: "reddit", query: "" }, { linkedin: 5 })).toBe(1);
    expect(unitWeight(one("linkedin"), { linkedin: 5 })).toBe(5);
  });

  it("runs nothing for a monitor with no units", () => {
    expect(nextTurn(state({ units: [] })).units).toEqual([]);
  });
});
