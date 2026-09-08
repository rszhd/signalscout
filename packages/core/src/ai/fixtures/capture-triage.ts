#!/usr/bin/env tsx
/**
 * Ask a real model to triage every comment US-029 labelled by hand, and record
 * what it said.
 *
 * Two jobs, and they are the same run.
 *
 * **The fixtures.** `triage-examples.test.ts` replays these answers, in CI, for
 * nothing. A recorded answer is the only kind of evidence a test can hold about
 * a model: an answer we wrote would be evidence about our own schema and none
 * about the model.
 *
 * **The instrument.** US-030's stage is the only paid one in front of the
 * classifier on a comment, so two numbers decide whether it may ship, and
 * nothing in the suite can produce either. **How many people asking did it
 * keep**, which is the safety number, and **how many people answering did it
 * drop**, which is the whole saving. US-029 labelled 46 real comments across
 * two threads for exactly this, and four of them are people asking.
 *
 * **Read the first number carefully; the first run did not.** US-029's `asking`
 * label answers "is this person asking?" and triage is asked something else:
 * "could this be a person to reach?" A person asking for a native Android
 * testing tool is asking, and a monitor selling a browser test runner should
 * not reach them. So a kept count below the total is not automatically a fault,
 * and the drops have to be read one at a time. That is why every one of them is
 * recorded here and in `filter_drops`.
 *
 * The four posts of PLAN.md's worked examples are triaged too, because the
 * stage runs on posts as well and the weakest of them, "Playwright is
 * awesome", is the one a triage model is most likely to refuse wrongly.
 *
 * It spends money: fifty short calls. The answer is one word, so the output is
 * about six tokens each.
 *
 *     pnpm --filter @signalscout/core capture:triage
 *     AI_TRIAGE_MODEL=gpt-5.6-luna pnpm --filter @signalscout/core capture:triage
 *
 * Put the results, the model and the date in the ticket that changed the
 * prompt. A number from a run nobody recorded is a comment, and a comment
 * cannot be re-run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aiEnvSchema } from "../../config/env.js";
import { type AiConfig, triageConfigFromEnvironment } from "../config.js";
import { createTriager } from "../triage.js";
import type { ItemForTriage, TriageVerdict } from "../triage-prompt.js";
import { exampleMonitor, labelledExamples } from "./examples.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const threadsAt = fileURLToPath(new URL("../../sources/deletion-fixtures/", import.meta.url));

/** Read .env without a dependency, the way `capture.ts` does. */
function readEnvFile(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }

  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    values[trimmed.slice(0, index).trim()] = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return values;
}

const environment = { ...readEnvFile(`${root}.env`), ...process.env };
const config: AiConfig = triageConfigFromEnvironment(aiEnvSchema.parse(environment));

if (!config.apiKey) {
  console.error("No key. Set AI_API_KEY, or AI_TRIAGE_API_KEY for a separate triage provider.");
  process.exit(1);
}

/** The two threads US-029 captured and labelled, in the order it measured them. */
const threads = [
  {
    name: "question-post",
    thread: "scrapecreators-comments-canonical.json",
    labels: "comment-labels.json",
  },
  {
    name: "statement-post",
    thread: "scrapecreators-comments-statement-post.json",
    labels: "comment-labels-statement-post.json",
  },
] as const;

interface CapturedComment {
  readonly id: string;
  readonly body?: string;
  readonly replies?: { readonly items?: readonly CapturedComment[] };
}

interface HandLabel {
  readonly id: string;
  readonly role: "asking" | "answering" | "neither";
  readonly topical: boolean;
}

function flatten(comments: readonly CapturedComment[]): CapturedComment[] {
  return comments.flatMap((comment) => [comment, ...flatten(comment.replies?.items ?? [])]);
}

interface Subject {
  readonly kind: "comment" | "post";
  readonly thread: string;
  readonly id: string;
  /** The hand label, where there is one. A post has none. */
  readonly role: HandLabel["role"] | null;
  readonly item: ItemForTriage;
}

const subjects: Subject[] = [];

for (const source of threads) {
  const thread = JSON.parse(readFileSync(`${threadsAt}${source.thread}`, "utf8")) as {
    post: { title: string; subreddit: string };
    comments: readonly CapturedComment[];
  };
  const hand = JSON.parse(readFileSync(`${threadsAt}${source.labels}`, "utf8")) as {
    labels: readonly HandLabel[];
  };
  const labelOf = new Map(hand.labels.map((label) => [label.id, label]));

  for (const comment of flatten(thread.comments)) {
    const label = labelOf.get(comment.id);
    if (!label) throw new Error(`${source.labels} has no label for ${comment.id}.`);

    subjects.push({
      kind: "comment",
      thread: source.name,
      id: comment.id,
      role: label.role,
      item: {
        source: "reddit",
        channel: thread.post.subreddit,
        // The parent post's title, because a comment borrows its subject from
        // the post above it. US-020 stores this; here it is read from the
        // fixture so the prompt sees what production will send.
        title: thread.post.title,
        excerpt: comment.body ?? "",
      },
    });
  }
}

for (const example of labelledExamples) {
  subjects.push({
    kind: "post",
    thread: "plan-examples",
    id: example.slug,
    role: null,
    item: {
      source: example.post.source,
      channel: example.post.channel,
      title: example.post.title,
      excerpt: example.post.excerpt,
    },
  });
}

const triager = createTriager({ config });

console.log(
  `Triaging ${subjects.length} items — ${subjects.filter((s) => s.kind === "comment").length} ` +
    `labelled comments and ${labelledExamples.length} worked examples — with ` +
    `${config.provider}/${config.model}.\n`,
);

interface Answer extends Subject {
  readonly verdict: TriageVerdict | null;
  readonly status: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costMicros?: number;
}

const answers: Answer[] = [];
let inputTokens = 0;
let outputTokens = 0;
let costMicros = 0;
let priced = true;

for (const subject of subjects) {
  const outcome = await triager.triage({ monitor: exampleMonitor, post: subject.item });

  inputTokens += outcome.call.inputTokens ?? 0;
  outputTokens += outcome.call.outputTokens ?? 0;
  if (outcome.call.estimatedCostMicros === undefined) priced = false;
  else costMicros += outcome.call.estimatedCostMicros;

  answers.push({
    ...subject,
    verdict: outcome.verdict,
    status: outcome.status,
    inputTokens: outcome.call.inputTokens,
    outputTokens: outcome.call.outputTokens,
    costMicros: outcome.call.estimatedCostMicros,
  });

  console.log(
    `  ${(outcome.verdict ?? outcome.status).padEnd(6)} ${(subject.role ?? subject.kind).padEnd(10)}` +
      ` ${subject.id.padEnd(18)} ${subject.item.excerpt.replace(/\s+/g, " ").slice(0, 72)}`,
  );
}

const comments = answers.filter((answer) => answer.kind === "comment");
const asking = comments.filter((answer) => answer.role === "asking");
const answering = comments.filter((answer) => answer.role === "answering");
const neither = comments.filter((answer) => answer.role === "neither");
const kept = (rows: readonly Answer[]) => rows.filter((row) => row.verdict !== "no").length;

const record = {
  provider: config.provider,
  model: config.model,
  capturedAt: new Date().toISOString(),
  note:
    "What a real triage model answered for every comment US-029 labelled by hand, plus PLAN.md's " +
    "four worked example posts. `triage-examples.test.ts` replays these. The two numbers that " +
    "decide the stage are here: how many people asking it kept, and how many people answering it " +
    "dropped, which is the saving. A kept count below the total is not automatically a fault: the " +
    "hand label says whether a person is asking, and triage is asked whether they are a person to " +
    "reach, which is a different question. Two threads and 46 comments is not a distribution.",
  monitor: exampleMonitor,
  counts: {
    items: answers.length,
    comments: comments.length,
    askingKept: kept(asking),
    asking: asking.length,
    answeringKept: kept(answering),
    answering: answering.length,
    neitherKept: kept(neither),
    neither: neither.length,
    commentsKept: kept(comments),
    unanswered: answers.filter((answer) => answer.verdict === null).length,
  },
  usage: {
    inputTokens,
    outputTokens,
    estimatedCostMicros: priced ? costMicros : undefined,
  },
  answers,
};

writeFileSync(`${here}triage-verdicts.json`, `${JSON.stringify(record, null, 2)}\n`);

console.log(`\nAsking kept:    ${kept(asking)} of ${asking.length}`);
for (const dropped of asking.filter((answer) => answer.verdict === "no")) {
  console.log(
    `  refused an asker: ${dropped.id} — ${dropped.item.excerpt.replace(/\s+/g, " ").slice(0, 90)}`,
  );
  console.log("  Read it against the monitor above before calling it a fault.");
}
console.log(`Answering kept: ${kept(answering)} of ${answering.length}`);
console.log(`Neither kept:   ${kept(neither)} of ${neither.length}`);
console.log(`Comments kept:  ${kept(comments)} of ${comments.length}`);
console.log(
  `\nWrote triage-verdicts.json. ${inputTokens} input and ${outputTokens} output tokens, ` +
    (priced
      ? `about ${(costMicros / 1_000_000).toFixed(6)} US dollars.`
      : `cost unknown: no price is configured for ${config.model}.`),
);
