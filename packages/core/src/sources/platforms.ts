/**
 * The platforms this product watches, apart from any provider code.
 *
 * A platform is what a person ticks and what `posts.source` stores. It is
 * described here rather than inside a connector folder because two providers
 * may fetch the same platform, and the platform must not belong to whichever
 * of them was written first. US-024 separated the two axes; `types.ts` says
 * why.
 *
 * Adding a platform is this file, a migration for `posts.source`, and at least
 * one connector. docs/sources.md holds the list.
 */
import type { PlatformDescriptor } from "./types.js";

export const redditPlatformId = "reddit";

export const redditPlatform: PlatformDescriptor = {
  id: redditPlatformId,
  displayName: "Reddit",
};

export const xPlatformId = "x";

export const xPlatform: PlatformDescriptor = {
  id: xPlatformId,
  displayName: "X",
};

/** Every platform the schema accepts, for a screen that lists them. */
export const platforms: readonly PlatformDescriptor[] = [redditPlatform, xPlatform];
