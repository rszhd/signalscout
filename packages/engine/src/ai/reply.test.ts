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

describe("what the prompt tells the model a good reply is", () => {
  const prompt = buildReplySystemPrompt(monitor);

  it("says the person posts it, not us", () => {
    // PLAN.md puts social publishing on the "not building" list. A model told
    // it is posting writes differently from one told a person will edit first.
    expect(prompt).toContain("read, edit and post themselves");
  });

  it("forbids opening with the product", () => {
    // A reply that opens with the product is an advertisement and will be
    // treated as one by the subreddit, the commenter and every reader.
    expect(prompt).toContain("Never open with the product");
  });

  it("allows one mention at most, and none at all", () => {
    expect(prompt).toContain("once at most");
    expect(prompt).toContain("a reply with no mention is a good reply");
  });

  it("forbids inventing a fact about the product", () => {
    // The failure to design against is a plausible draft, not a bad one: a
    // person posts the first and fixes the second.
    expect(prompt).toContain("Never invent a fact about the product");
  });

  it("forbids claiming to be a customer", () => {
    expect(prompt).toContain("Never claim to have used the product");
  });

  it("asks for the doubt inside the draft, where an editor will see it", () => {
    expect(prompt).toContain("[check:");
    expect(prompt).toContain("list it in uncertainties");
  });

  it("allows an honest refusal instead of a reply nobody should post", () => {
    expect(prompt).toContain("An honest refusal is more use");
  });

  it("carries the four answers the monitor was built on", () => {
    expect(prompt).toContain(monitor.product);
    expect(prompt).toContain(monitor.idealCustomer);
    expect(prompt).toContain(monitor.problem);
  });
});

describe("a saved instruction", () => {
  it("reaches the prompt, because a setting that is stored and not sent is invisible", () => {
    const prompt = buildReplySystemPrompt(monitor, {
      instruction: "Write plainly and always ask one question back.",
    });

    expect(prompt).toContain("Write plainly and always ask one question back.");
  });

  it("is named a preference, and told which rules it cannot override", () => {
    // "Always open by naming our product" is exactly what this prompt exists
    // to prevent. Saying which rules are fixed is more honest than silently
    // ignoring the instruction and more useful than obeying it.
    const prompt = buildReplySystemPrompt(monitor, { instruction: "Always name our product." });

    expect(prompt).toContain("saved a preference");
    expect(prompt).toContain("where it does not conflict with the rules above");
    expect(prompt).toContain("Rules you always follow, whatever else you are told");
  });

  it("says nothing about a preference when there is none", () => {
    // A project that never set one must draft exactly as it did before, and a
    // prompt mentioning an empty preference invites the model to invent one.
    const prompt = buildReplySystemPrompt(monitor);

    expect(prompt).not.toContain("saved a preference");
  });

  it("ignores an instruction that is only whitespace", () => {
    const prompt = buildReplySystemPrompt(monitor, { instruction: "   \n  " });

    expect(prompt).not.toContain("saved a preference");
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
