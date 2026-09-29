import { describe, expect, it } from "vitest";
import { maximumPagesPerInput, pagesPerInputFor } from "./pages.js";

describe("pagesPerInputFor", () => {
  it("is the connector's own cap when the caller asks for nothing", () => {
    expect(pagesPerInputFor({}, 2)).toBe(2);
  });

  it("is the caller's count when it asks for one", () => {
    expect(pagesPerInputFor({ pagesPerInput: 10 }, 2)).toBe(10);
    expect(pagesPerInputFor({ pagesPerInput: 1 }, 2)).toBe(1);
  });

  it.each([0, -1, 1.5, maximumPagesPerInput + 1, Number.NaN])(
    "refuses %s rather than billing it",
    (asked) => {
      expect(() => pagesPerInputFor({ pagesPerInput: asked }, 2)).toThrow(RangeError);
    },
  );
});
