// @vitest-environment jsdom
/**
 * The mark renders itself: the size is its prop, so no page needs a rule for
 * it. US-283. `theme.test.ts` holds the other half, that the one rule which
 * styles it clips nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BrandLogo } from "./BrandLogo.js";
import { mount, type Screen } from "./testing/harness.js";

describe("BrandLogo", () => {
  let screen: Screen | undefined;
  afterEach(async () => {
    await screen?.unmount();
    screen = undefined;
  });

  it("renders the canonical mark at 32 pixels unless told otherwise", async () => {
    screen = await mount(<BrandLogo />);
    const img = screen.container.querySelector("img.brand-logo");
    expect(img?.getAttribute("src")).toBe("/brand/mark.svg");
    expect(img?.getAttribute("width")).toBe("32");
    expect(img?.getAttribute("height")).toBe("32");
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("takes its size from the prop, so no page needs a rule for it", async () => {
    screen = await mount(<BrandLogo size={40} />);
    const img = screen.container.querySelector("img.brand-logo");
    expect(img?.getAttribute("width")).toBe("40");
    expect(img?.getAttribute("height")).toBe("40");
  });
});
