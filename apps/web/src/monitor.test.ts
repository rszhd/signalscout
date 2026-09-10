/**
 * The words and the arithmetic both monitor screens share. US-109.
 *
 * These moved out of `Monitors.test.tsx` with the functions themselves. They
 * are asserted once, here, rather than on each screen: the list and the
 * monitor page must say the same thing about the same row, and a rule tested
 * through two screens is a rule that can be edited on one of them.
 */
import { describe, expect, it } from "vitest";
import { formatMicros, toMicros } from "./monitor.js";

describe("the money on the screen", () => {
  it("keeps the places a small amount needs", () => {
    // Ten Reddit records cost $0.015. Rounded to cents that is two, and a page
    // that rounds every small number up cannot be reconciled with an invoice.
    expect(formatMicros(15_000)).toBe("$0.015");
    expect(formatMicros(15_000_000)).toBe("$15.00");
    expect(formatMicros(0)).toBe("$0.00");
  });

  it("turns dollars into micro-dollars, and refuses what is not an amount", () => {
    expect(toMicros("2.50")).toBe(2_500_000);
    expect(toMicros("0")).toBe(0);
    expect(toMicros("lots")).toBeNull();
    expect(toMicros("-1")).toBeNull();
  });
});
