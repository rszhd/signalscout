/**
 * What both products say about a match. US-352.
 *
 * The inbox tests in each application assert these through the screen; this
 * file asserts the words themselves, so a change to one is caught where it is
 * made rather than in two applications' screens.
 */
import { describe, expect, it } from "vitest";
import {
  limitWords,
  opensThreadOnly,
  platformLabel,
  threadDepth,
  whereItCameFrom,
} from "./match.js";
import { match } from "./testing/matches.js";

describe("where a match came from", () => {
  it("names the subreddit on Reddit and the handle on X, LinkedIn and TikTok", () => {
    expect(whereItCameFrom(match({ source: "reddit", channel: "devops" }))).toBe(
      "Reddit · r/devops",
    );
    for (const [source, name] of [
      ["x", "X"],
      ["linkedin", "LinkedIn"],
      ["tiktok", "TikTok"],
    ]) {
      expect(whereItCameFrom(match({ source, author: "maria" }))).toBe(`${name} · @maria`);
    }
  });

  it("names the channel on YouTube as it is, with no prefix", () => {
    expect(whereItCameFrom(match({ source: "youtube", channel: "Fireship" }))).toBe(
      "YouTube · Fireship",
    );
  });

  it("names the platform alone when there is no place, and an unknown platform by its id", () => {
    expect(whereItCameFrom(match({ source: "reddit", channel: null }))).toBe("Reddit");
    expect(whereItCameFrom(match({ source: "mastodon", author: "maria" }))).toBe("mastodon");
  });
});

describe("what the conversation link can promise", () => {
  it("opens the reply itself on every known platform", () => {
    for (const source of ["reddit", "x", "linkedin", "youtube", "tiktok"]) {
      expect(opensThreadOnly(match({ source, kind: "reply" }))).toBe(false);
    }
  });

  it("promises only the post for a reply on an unknown platform", () => {
    expect(platformLabel("mastodon").commentLink).toBe("thread");
    expect(opensThreadOnly(match({ source: "mastodon", kind: "reply" }))).toBe(true);
    expect(opensThreadOnly(match({ source: "mastodon", kind: "post" }))).toBe(false);
  });
});

describe("the preview of a post", () => {
  it("keeps a post of up to the limit whole", () => {
    expect(limitWords("one two three", 3)).toEqual({ text: "one two three", truncated: false });
  });

  it("cuts a longer post at the limit and says it did", () => {
    expect(limitWords("one two three four", 3)).toEqual({
      text: "one two three…",
      truncated: true,
    });
  });
});

describe("how much of a reply's thread was read", () => {
  const reply = (overrides: Parameters<typeof match>[0]) =>
    match({ kind: "reply", parentRepliesRead: 100, parentReplyCount: 1713, ...overrides });

  it("says nothing about a post", () => {
    expect(threadDepth(match({ kind: "post", parentRepliesRead: 100 }))).toBeUndefined();
  });

  it("says why reading stopped, with the count against the thread's size", () => {
    expect(threadDepth(reply({ parentRepliesStopped: "threshold" }))).toBe(
      "100 of 1,713 comments read. Stopped: the last batch held no lead.",
    );
    expect(threadDepth(reply({ parentRepliesStopped: "budget" }))).toBe(
      "100 of 1,713 comments read. Stopped: the monitor reached its budget.",
    );
    expect(threadDepth(reply({ parentRepliesStopped: "ceiling" }))).toBe(
      "100 of 1,713 comments read. Stopped: this is as deep as one thread is read.",
    );
  });

  it("drops the total when the whole thread was read", () => {
    expect(
      threadDepth(
        reply({ parentRepliesRead: 1, parentReplyCount: 1, parentRepliesStopped: "end" }),
      ),
    ).toBe("1 comment read — the whole thread.");
  });

  it("says nothing while the thread is still being read", () => {
    expect(threadDepth(reply({ parentRepliesStopped: null }))).toBeUndefined();
  });

  it("says nothing, rather than throwing, when an older API leaves the fields out", () => {
    const old = reply({});
    delete old.parentRepliesRead;
    delete old.parentReplyCount;
    delete old.parentRepliesStopped;
    expect(threadDepth(old)).toBeUndefined();
  });
});
