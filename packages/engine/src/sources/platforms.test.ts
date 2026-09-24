/**
 * The text a person reads under each platform's queries. US-385.
 *
 * The form prints its own line first — plain phrases, no AND, OR or quotes,
 * and "2 to N words" — so a hint that repeats either says it twice. The hint
 * is also not the model's note, which gives the model orders and our costs.
 */
import { describe, expect, it } from "vitest";
import { platforms } from "./platforms.js";

describe("a platform's hint", () => {
  it("exists for every platform a person can search", () => {
    for (const platform of platforms) {
      expect(platform.search?.hint, platform.id).toBeTruthy();
    }
  });

  it("is written for a person, not copied from the model's note", () => {
    for (const platform of platforms) {
      expect(platform.search?.hint, platform.id).not.toBe(platform.search?.note);
    }
  });

  it("repeats neither the word limit nor the syntax rule the form already states", () => {
    for (const platform of platforms) {
      const hint = platform.search?.hint ?? "";

      expect(hint, platform.id).not.toMatch(
        /\b(?:\d+|two|three|four|five|six|seven|eight) words\b/i,
      );
      expect(hint, platform.id).not.toMatch(/\bAND\b|\bOR\b|quote/);
    }
  });
});
