/**
 * The reply prompt.
 *
 * This file asserts the words, not the model's behaviour. A prompt is the only
 * thing standing between "write a reply" and a landing page, and the rules in
 * it are the product decision — so a change that removes one should turn a
 * test red rather than quietly change what everybody's drafts sound like.
 *
 * What a real model does with these words is measured by `capture:reply` and
 * replayed in `reply-examples.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { MonitorProfile, PostForClassification } from "./prompt.js";
import { buildReplySystemPrompt, buildReplyUserPrompt } from "./reply.js";

const monitor: MonitorProfile = {
  product: "A hosted browser test runner that reruns and quarantines flaky tests",
  idealCustomer: "A small SaaS team with no dedicated QA engineer",
  problem: "End-to-end tests fail at random and nobody trusts the suite",
  signals: [],
};

const post: PostForClassification = {
  source: "reddit",
  channel: "softwaretesting",
  author: "somebody",
  title: "Our CI is red half the time and I cannot tell why",
  excerpt: "Every second run fails on a different test. What do people actually use for this?",
  postedAt: new Date("2026-09-07T08:00:00.000Z"),
};

/**
 * US-405: the prompt holds facts, and the voice holds every rule. These cases
 * say both halves, so a rule that creeps back into the code turns one red.
 */
describe("the prompt without a voice", () => {
  const prompt = buildReplySystemPrompt(monitor);

  it("says the person posts it, not us", () => {
    // PLAN.md puts social publishing on the "not building" list. A model told
    // it is posting writes differently from one told a person will edit first.
    expect(prompt).toContain("edit it and post it themselves");
  });

  it("carries the four answers the monitor was built on", () => {
    expect(prompt).toContain(monitor.product);
    expect(prompt).toContain(monitor.idealCustomer);
    expect(prompt).toContain(monitor.problem);
  });

  it("holds no rule of its own about the reply or the product", () => {
    expect(prompt).not.toMatch(/never|always|mention|\[check:|refus/i);
  });
});

describe("a voice", () => {
  it("reaches the prompt word for word, as the way to write this reply", () => {
    const instruction = "Write plainly and always ask one question back.";
    const prompt = buildReplySystemPrompt(monitor, { instruction });

    expect(prompt).toContain(`How to write this reply:\n${instruction}`);
  });

  it("is the whole of the guidance: nothing in the prompt argues with it", () => {
    const prompt = buildReplySystemPrompt(monitor, {
      instruction: "Open with our product name.",
    });

    expect(prompt).toContain("Open with our product name.");
    expect(prompt).not.toMatch(/whatever else you are told|preference|conflict/i);
  });

  it("adds nothing when it is only whitespace", () => {
    expect(buildReplySystemPrompt(monitor, { instruction: "   \n  " })).toBe(
      buildReplySystemPrompt(monitor),
    );
  });
});

describe("the post the model answers", () => {
  it("gives the post, where it was, and what it says", () => {
    const written = buildReplyUserPrompt(post);

    expect(written).toContain("reddit (softwaretesting)");
    expect(written).toContain(post.title as string);
    expect(written).toContain(post.excerpt);
  });

  it("marks the thread as context and names who is being answered", () => {
    // The same reason the classifier gets the thread: "we hit this too, what
    // did you end up using?" names no product and no problem, and a draft
    // written without the thread answers the wrong person.
    const written = buildReplyUserPrompt({
      ...post,
      thread: {
        postTitle: "Playwright or Selenium in 2026?",
        postExcerpt: "We are picking a runner for a new suite.",
        parentReplyExcerpt: "Playwright, easily.",
      },
    });

    expect(written).toContain("for context only — you are not answering these");
    expect(written).toContain("Playwright or Selenium in 2026?");
    expect(written).toContain("Playwright, easily.");
    // And the person being answered comes last, after the context.
    expect(written.indexOf("Answer this person")).toBeGreaterThan(
      written.indexOf("Playwright, easily."),
    );
  });

  it("says nothing about a thread on a post that has none", () => {
    expect(buildReplyUserPrompt(post)).not.toContain("for context only");
  });
});
