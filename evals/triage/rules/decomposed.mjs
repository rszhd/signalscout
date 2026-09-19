/**
 * The triage question, shaped the way TypeSafe documents. US-230, after
 * reading docs.typesafe.ai rather than guessing from the SDK types.
 *
 * **What the earlier mappings got wrong.** `mapping.ts` put the whole decision
 * in one Choice question, with a nine-field block of rules as `instructions`
 * and three prose strings as `criteria`. The docs say each of those is the
 * wrong shape:
 *
 * - `instructions` is *the question to answer*, not a rule book.
 * - criteria descriptions are what separate the options, and for options that
 *   resemble each other they should be objects with `what`, `not_for` and
 *   `examples` rather than a sentence.
 * - "System One models work best when each question asks one specific,
 *   well-scoped thing. Ask each factor as a separate question, then combine
 *   the results with logic in your code."
 *
 * `no`, `maybe` and `yes` are three shades of one judgement, so asking for
 * them directly asks the model to do the combining. That is what produced
 * confidences of 0.13 and 0.21 on leads a person would call obvious.
 *
 * **So this asks three narrow questions in one call** — the Speculative
 * Fan-Out pattern — and combines them here, in the order `triage-prompt.ts`
 * combines them. Every branch below traces to a paragraph there.
 */

/**
 * Who is writing. The prompt's HOW TO CHOOSE and NOTHING TO JUDGE IS A NO.
 *
 * `answering_others` is named first in the prompt as the largest group and the
 * one the stage exists to refuse, so it gets the sharpest `not_for`.
 */
const author = {
  type: "choice",
  instructions: "Who is writing this, and in what role?",
  criteria: {
    describing_own_problem: {
      what: "Someone describing a difficulty, a need or a situation of their own.",
      not_for: "Describing somebody else's problem, or discussing the topic in the abstract.",
      examples: [
        "our tests break whenever the UI changes",
        "I built a tool and launched it, zero signups so far",
        "I need advice, my agency builds everything and I cannot reach buyers",
      ],
    },
    asking_others: {
      what: "Someone asking what others use, asking for a recommendation, or asking for help.",
      not_for: "A rhetorical question, or a question asked to set up their own answer.",
      examples: [
        "we hit this too, what did you end up using?",
        "what acquisition channel worked for you when you were early?",
        "any suggestions on how I can generate leads fast?",
      ],
    },
    answering_others: {
      what: "Someone answering, advising, naming tools, correcting or arguing. An expert, not a buyer.",
      not_for: "Someone who gives advice and then asks for some of their own.",
      examples: [
        "just use cold email, it works fine",
        "Selenium is not better at anything",
        "I'd put all my early energy into locator strategy",
      ],
    },
    selling_or_promoting: {
      what: "Someone advertising, launching, demoing or marketing their own product or content.",
      not_for:
        "Someone who mentions or links their own product while asking for help with it. That is asking, not selling.",
      examples: [
        "I built an AI that finds customers while I sleep — link in bio",
        "How I hacked growth to build a $1M SaaS (full demo)",
      ],
    },
    nobody_to_weigh: {
      what: "Text with no author to judge: a moderator notice, an automatic reply, a bare reaction that only agrees, a joke, an insult, a link with no words.",
      not_for: "A short message that still asks for something. Short and asking is not empty.",
      examples: ["[removed by moderator]", "same", "I wouldn't be surprised", "this"],
    },
  },
};

/** Does anything here say they want an answer? The prompt's want test. */
const want = {
  type: "choice",
  instructions: "Does this author say they want an answer, a tool or help?",
  criteria: {
    explicit_ask: {
      what: "They ask for it outright: a recommendation, what others use, or help with something of their own.",
      not_for: "A question aimed at somebody else's claim rather than at their own need.",
      examples: ["any recommendations?", "how did you solve this?", "what should I use?"],
    },
    implied_want: {
      what: "They describe a problem, a frustration or something not working, without asking. A complaint counts.",
      not_for: "Reporting a problem that is not theirs.",
      examples: [
        "our tests break whenever the UI changes",
        "zero signups so far and I don't know why",
      ],
    },
    wants_nothing: {
      what: "They ask for nothing and describe no difficulty of their own.",
      not_for: "Anyone who asks for something, however briefly.",
      examples: ["Playwright is awesome", "here is how I did it", "nice work"],
    },
  },
};

/** Could the product reach them? The prompt's ASKING FOR SOMETHING ELSE IS A NO. */
const fit = {
  type: "choice",
  instructions:
    "Measured against the product in the state, could this author ever be its customer?",
  criteria: {
    could_be: {
      what: "Their situation is the one the product is for, or close enough that a careful reader should look.",
      not_for: "Merely writing about the same subject. Being on topic is not being a customer.",
      examples: null,
    },
    wrong_product: {
      what: "They want a tool this product does not make, or a platform it does not cover, so it could never serve them.",
      not_for: "An adjacent need the product partly serves.",
      examples: null,
    },
    cannot_tell: {
      what: "There is not enough here to say either way.",
      not_for: "A clear mismatch. That is wrong_product, not doubt.",
      examples: null,
    },
  },
};

export const questions = { author, want, fit };

/** The state: the monitor, then the item. Structured, as the docs ask for. */
export function stateFor(monitor, item) {
  return {
    theProduct: monitor.product,
    theIdealCustomer: monitor.idealCustomer,
    theProblemItSolves: monitor.problem,
    signalsTheUserAskedFor: [...monitor.signals],
    item: {
      source: item.source,
      ...(item.channel ? { channel: item.channel } : {}),
      ...(item.title ? { title: item.title } : {}),
      text: item.excerpt,
    },
  };
}

/**
 * The combining, in `triage-prompt.ts`'s own order of precedence.
 *
 * 1. Nothing to judge is a no.
 * 2. Asking for something this product does not make is a no, however plainly
 *    they ask.
 * 3. An explicit ask beats every refusal above it.
 * 4. A person describing a problem of their own is the one to pass on.
 * 5. Selling, or answering somebody else with no want of their own, is a no.
 * 6. Anything left is a maybe: doubt about a want, not about everything.
 */
export function decide(a, confidence = {}, floor = 0.6) {
  const sure = (q) => (confidence[q] ?? 1) >= floor;

  if (a.author === "nobody_to_weigh") {
    return { verdict: "no", because: "there is no author to weigh", decidedBy: "author" };
  }

  /**
   * A veto needs to be sure of itself.
   *
   * The first run of this combiner let `wrong_product` refuse two leads that
   * asked outright, at confidence 0.39 and 0.40, where the four it kept
   * answered 1.00. A rule that deletes a lead on a judgement the model is
   * half-making is the exact failure `triage.ts` is built to avoid, so an
   * unsure mismatch is not a mismatch.
   *
   * **Only this veto is gated.** Gating the other two as well was measured and
   * was worse: it turned every unsure `answering_others` into a keep and took
   * the run from 25 keeps to 87, for the same six leads. Being unsure who is
   * writing is the ordinary case, and it is not a reason to buy a
   * classification.
   */
  if (a.fit === "wrong_product" && sure("fit")) {
    return {
      verdict: "no",
      because: "they want something this product does not make",
      decidedBy: "fit",
    };
  }

  if (a.want === "explicit_ask") {
    return { verdict: "yes", because: "they ask for something outright", decidedBy: "want" };
  }

  if (a.author === "describing_own_problem" || a.author === "asking_others") {
    return {
      verdict: a.want === "wants_nothing" ? "maybe" : "yes",
      because: "they describe a problem of their own",
      decidedBy: "author",
    };
  }

  if (a.author === "selling_or_promoting" || a.author === "answering_others") {
    if (a.want === "implied_want") {
      return {
        verdict: "maybe",
        because: "they are selling or answering, but something may be wanted",
        decidedBy: "author",
      };
    }

    return {
      verdict: "no",
      because: "they are selling or answering, and want nothing of their own",
      decidedBy: "author",
    };
  }

  return { verdict: "maybe", because: "a want that cannot be weighed", decidedBy: "want" };
}
