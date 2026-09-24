/**
 * The shipped voices. US-405.
 *
 * Since the reply prompt holds no rules, these texts are where the rules live
 * for anybody who has not written their own. Each voice is used alone, so
 * each must carry every one of them; a voice that lost one would draft
 * without it and nothing else would say so.
 */
import { describe, expect, it } from "vitest";
import { replyVoicePresets } from "./reply-voices.js";

describe("every shipped voice", () => {
  it.each(replyVoicePresets.map((preset) => [preset.name, preset.instruction]))(
    "%s carries the product and honesty rules",
    (_, instruction) => {
      expect(instruction).toContain("Answer the person first");
      expect(instruction).toContain('say "I built X" or "we make X"');
      expect(instruction).toContain("Never invent a feature");
      expect(instruction).toContain("[check: the product does not fit this post]");
      expect(instruction).toContain("Never claim to be a customer");
      expect(instruction).toContain("write the doubt into the draft as [check: …]");
      expect(instruction).toContain("say so in the reply field");
    },
  );

  it("has its own id, name and shape", () => {
    const shapes = replyVoicePresets.map(
      (preset) => preset.instruction.split("\n\nThe product:")[0],
    );

    expect(new Set(replyVoicePresets.map((preset) => preset.id)).size).toBe(
      replyVoicePresets.length,
    );
    expect(new Set(replyVoicePresets.map((preset) => preset.name)).size).toBe(
      replyVoicePresets.length,
    );
    expect(new Set(shapes).size).toBe(replyVoicePresets.length);
  });
});
