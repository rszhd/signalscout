#!/usr/bin/env tsx
/**
 * Ask a real embedding model what the pre-filter would do to a comment.
 *
 * US-020 will store Reddit comments, and the second stage of US-008's
 * pre-filter has no obvious setting on one. A post carries its own topic. A
 * comment borrows it from the post above. That leaves two settings and an
 * argument nobody can win from a desk:
 *
 *   * **Embed the comment alone.** The stage filters, but a short comment
 *     carries no topic, so the comment the feature exists to find is dropped.
 *   * **Embed the parent title with the comment.** The topic is restored, and
 *     every comment in the thread inherits the parent's similarity, so nothing
 *     is dropped and the stage is a cost.
 *
 * This measures both, against the same monitor `capture-embeddings.ts` used,
 * so the numbers here and the numbers in `similarities.json` are comparable.
 *
 * **The data is on disk and was free.** `sources/deletion-fixtures/`
 * holds one real r/softwaretesting thread captured live for the deletion work:
 * one post and twenty-one real comment bodies. `comment-labels.json` beside it
 * holds a hand label for every one — who the author is, and whether the comment
 * is about test automation at all.
 *
 * **Twenty-one comments in one thread is not a distribution.** Nothing this
 * prints may be written up as one. It is one thread, on one subject, against
 * one monitor.
 *
 * It spends money: two short calls, well under a hundredth of a cent.
 *
 *     pnpm --filter @signalscout/core capture:comment-filter
 *
 * What it records is the similarities and not the vectors, for the reason
 * `capture-embeddings.ts` gives: the similarity is the number the threshold is
 * compared against and the number `filter_drops` stores.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aiEnvSchema } from "../../config/env.js";
import { defaultSimilarityThreshold } from "../../db/schema.js";
import { monitorDescriptionText, postEmbeddingText } from "../../filter/description.js";
import { type EmbeddingConfig, embeddingConfigFromEnvironment } from "../config.js";
import { createEmbedder } from "../embed.js";
import { exampleMonitor } from "./examples.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const fixtures = fileURLToPath(new URL("../../sources/deletion-fixtures/", import.meta.url));

/** Read .env without a dependency, the way `capture-embeddings.ts` does. */
function readEnvFile(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }

  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^["']|["']$/g, "")];
      }),
  );
}

const environment = { ...readEnvFile(`${root}.env`), ...process.env };
const config: EmbeddingConfig | undefined = embeddingConfigFromEnvironment(
  aiEnvSchema.parse(environment),
);

if (!config || (!config.apiKey && config.provider !== "ollama")) {
  console.error(
    [
      "No embedding model. Set AI_EMBEDDING_PROVIDER and AI_EMBEDDING_MODEL in .env.",
      "",
      "AI_EMBEDDING_PROVIDER is openai, google, openrouter or ollama. Neither",
      "Anthropic nor DeepSeek publishes an embedding endpoint, so a deployment",
      "on either has to name another provider here. On openai the model defaults to",
      "text-embedding-3-small and the key falls back to AI_API_KEY.",
      "",
      "This run makes two short calls and costs well under a hundredth of a cent.",
    ].join("\n"),
  );
  process.exit(1);
}

/** Cosine similarity, as `pgvector` computes it, here so the script needs no database. */
function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;

  for (const [index, value] of left.entries()) {
    const other = right[index] ?? 0;
    dot += value * other;
    leftLength += value * value;
    rightLength += other * other;
  }

  return dot / (Math.sqrt(leftLength) * Math.sqrt(rightLength));
}

interface CapturedComment {
  readonly id: string;
  readonly body?: string | null;
  readonly replies?: { readonly items?: readonly CapturedComment[] } | null;
}

interface CapturedThread {
  readonly post: { readonly id: string; readonly title: string; readonly subreddit: string };
  readonly comments: readonly CapturedComment[];
}

interface HandLabel {
  readonly id: string;
  readonly depth: number;
  readonly role: "asking" | "answering" | "neither";
  readonly topical: boolean;
  readonly why: string;
}

interface HandLabels {
  readonly labels: readonly HandLabel[];
}

/**
 * The threads this instrument can read, and why there is more than one.
 *
 * The first run measured `question-post` and could not answer its own central
 * question: every commenter under a post that asks for advice is answering it,
 * so `asking` was empty and the two classes were never weighed. US-029's Log
 * asked for a thread holding a real asker. `statement-post` is that thread —
 * its post is an opinion about two tools, so the people underneath it include
 * some describing problems of their own.
 *
 * Name one on the command line. The default stays the first thread, so a
 * re-run reproduces the committed numbers rather than overwriting them with a
 * different subject.
 */
const threads = {
  "question-post": {
    thread: "scrapecreators-comments-canonical.json",
    labels: "comment-labels.json",
    output: "comment-similarities.json",
  },
  "statement-post": {
    thread: "scrapecreators-comments-statement-post.json",
    labels: "comment-labels-statement-post.json",
    output: "comment-similarities-statement-post.json",
  },
} as const;

type ThreadName = keyof typeof threads;

function threadArgument(): ThreadName {
  const asked = process.argv.slice(2).find((value) => !value.startsWith("-"));
  if (asked === undefined) return "question-post";
  if (asked in threads) return asked as ThreadName;

  console.error(`Unknown thread "${asked}". Choose one of: ${Object.keys(threads).join(", ")}.`);
  process.exit(1);
}

const chosen = threads[threadArgument()];

const thread = JSON.parse(readFileSync(`${fixtures}${chosen.thread}`, "utf8")) as CapturedThread;

const hand = JSON.parse(readFileSync(`${fixtures}${chosen.labels}`, "utf8")) as HandLabels;

/** Every comment in the thread, top level and nested, in the order a reader meets them. */
function flatten(comments: readonly CapturedComment[]): CapturedComment[] {
  return comments.flatMap((comment) => [comment, ...flatten(comment.replies?.items ?? [])]);
}

const comments = flatten(thread.comments);
const parentTitle = thread.post.title;

const labelOf = new Map(hand.labels.map((label) => [label.id, label]));
for (const comment of comments) {
  if (!labelOf.has(comment.id)) {
    throw new Error(`${chosen.labels} has no label for ${comment.id}. Label it by hand first.`);
  }
}

/**
 * The two settings, built with the same function the pre-filter uses.
 *
 * `postEmbeddingText` joins a title and a body, so "with the parent title" is
 * exactly what the stage would send if a comment were stored under its post's
 * title. Nothing here reimplements the production text.
 */
const alone = comments.map((comment) =>
  postEmbeddingText({ title: null, excerpt: comment.body ?? "" }),
);
const withParent = comments.map((comment) =>
  postEmbeddingText({ title: parentTitle, excerpt: comment.body ?? "" }),
);
const baseline = postEmbeddingText({ title: parentTitle, excerpt: "" });

const embedder = createEmbedder({ config });

console.log(
  `Embedding one r/${thread.post.subreddit} thread — ${comments.length} comments, two ways — ` +
    `with ${config.provider}/${config.model}.`,
);
console.log(`The monitor is PLAN.md's example, the same one capture:embeddings used.\n`);

const monitorText = monitorDescriptionText(exampleMonitor);
const monitorOutcome = await embedder.embed([monitorText]);

if (monitorOutcome.status !== "embedded") {
  console.error(`failed — ${monitorOutcome.error}`);
  process.exit(1);
}

const monitorVector = monitorOutcome.embeddings[0];

if (!monitorVector) {
  console.error("failed — the model returned no embedding for the monitor.");
  process.exit(1);
}

const commentOutcome = await embedder.embed([baseline, ...alone, ...withParent]);

if (commentOutcome.status !== "embedded") {
  console.error(`failed — ${commentOutcome.error}`);
  process.exit(1);
}

/**
 * `EmbedOutcome` is a union and the narrowing above does not survive into a
 * closure, so both sides are bound once, here, with their settled types.
 */
const monitor: readonly number[] = monitorVector;
const commentVectors: readonly (readonly number[])[] = commentOutcome.embeddings;

function similarityAt(index: number): number {
  const vector = commentVectors[index];
  if (!vector) throw new Error(`The model returned no embedding at position ${index}.`);

  return Number(cosineSimilarity(monitor, vector).toFixed(6));
}

const parentTitleAlone = similarityAt(0);

const measured = comments.map((comment, index) => {
  const label = labelOf.get(comment.id);
  if (!label) throw new Error(`comment-labels.json has no label for ${comment.id}.`);

  return {
    id: comment.id,
    depth: label.depth,
    role: label.role,
    topical: label.topical,
    alone: similarityAt(1 + index),
    withParent: similarityAt(1 + comments.length + index),
  };
});

type Mode = "alone" | "withParent";
const modes: readonly Mode[] = ["alone", "withParent"];

/**
 * Does any threshold put every member of one class above every member of the
 * other? A gap of zero or less means no threshold exists, however it is tuned.
 */
function separation(
  keep: readonly { readonly alone: number; readonly withParent: number }[],
  drop: readonly { readonly alone: number; readonly withParent: number }[],
  mode: Mode,
): { readonly lowestKept: number; readonly highestDropped: number; readonly gap: number } | null {
  if (keep.length === 0 || drop.length === 0) return null;

  const lowestKept = Math.min(...keep.map((entry) => entry[mode]));
  const highestDropped = Math.max(...drop.map((entry) => entry[mode]));

  return {
    lowestKept: Number(lowestKept.toFixed(6)),
    highestDropped: Number(highestDropped.toFixed(6)),
    gap: Number((lowestKept - highestDropped).toFixed(6)),
  };
}

const asking = measured.filter((entry) => entry.role === "asking");
const answering = measured.filter((entry) => entry.role === "answering");
const topical = measured.filter((entry) => entry.topical);
const offTopic = measured.filter((entry) => !entry.topical);

const analysis = Object.fromEntries(
  modes.map((mode) => [
    mode,
    {
      lowest: Number(Math.min(...measured.map((entry) => entry[mode])).toFixed(6)),
      highest: Number(Math.max(...measured.map((entry) => entry[mode])).toFixed(6)),
      keptAtDefaultThreshold: measured.filter((entry) => entry[mode] >= defaultSimilarityThreshold)
        .length,
      askingAgainstAnswering: separation(asking, answering, mode),
      topicalAgainstOffTopic: separation(topical, offTopic, mode),
    },
  ]),
);

const tokens = (monitorOutcome.call.inputTokens ?? 0) + (commentOutcome.call.inputTokens ?? 0);
const costMicros =
  monitorOutcome.call.estimatedCostMicros === undefined ||
  commentOutcome.call.estimatedCostMicros === undefined
    ? undefined
    : monitorOutcome.call.estimatedCostMicros + commentOutcome.call.estimatedCostMicros;

const record = {
  provider: config.provider,
  model: config.model,
  capturedAt: new Date().toISOString(),
  note:
    "Cosine similarity between PLAN.md's example monitor and every comment in one captured " +
    "r/softwaretesting thread, measured three ways: the comment alone, the comment under its " +
    "parent post's title, and the parent title by itself as the baseline. The vectors are not " +
    "kept, for the reason capture-embeddings.ts gives. This is one thread and it is not a " +
    "distribution.",
  dimensions: monitorVector.length,
  monitorText,
  thread: {
    fixture: `sources/deletion-fixtures/${chosen.thread}`,
    labels: `sources/deletion-fixtures/${chosen.labels}`,
    postId: thread.post.id,
    postTitle: parentTitle,
    subreddit: thread.post.subreddit,
  },
  defaultSimilarityThreshold,
  parentTitleAlone,
  comments: measured,
  analysis,
  usage: { tokens },
  latencyMs: monitorOutcome.call.latencyMs + commentOutcome.call.latencyMs,
  estimatedCostMicros: costMicros,
};

writeFileSync(`${here}${chosen.output}`, `${JSON.stringify(record, null, 2)}\n`);

console.log(`The parent title on its own scores ${parentTitleAlone.toFixed(4)}.\n`);

console.log("  ALONE   +PARENT  ROLE       TOPICAL  COMMENT");
for (const entry of [...measured].sort((left, right) => right.alone - left.alone)) {
  console.log(
    `  ${entry.alone.toFixed(4)}  ${entry.withParent.toFixed(4)}  ` +
      `${entry.role.padEnd(10)} ${entry.topical ? "yes    " : "no     "}  ${entry.id}`,
  );
}

for (const mode of modes) {
  const result = analysis[mode];
  if (!result) continue;

  console.log(
    `\n${mode === "alone" ? "COMMENT ALONE" : "COMMENT UNDER THE PARENT TITLE"}` +
      `\n  range ${result.lowest.toFixed(4)} to ${result.highest.toFixed(4)}` +
      `\n  ${result.keptAtDefaultThreshold} of ${measured.length} kept at the default ` +
      `threshold of ${defaultSimilarityThreshold}`,
  );

  for (const [question, gap] of [
    ["asking against answering", result.askingAgainstAnswering],
    ["about testing against not", result.topicalAgainstOffTopic],
  ] as const) {
    console.log(
      gap === null
        ? `  ${question}: one of the two classes is empty in this thread, so nothing is measured`
        : gap.gap > 0
          ? `  ${question}: separated. A threshold between ${gap.highestDropped.toFixed(4)} and ` +
            `${gap.lowestKept.toFixed(4)} does it, a gap of ${gap.gap.toFixed(4)}`
          : `  ${question}: no threshold separates them. The lowest kept is ` +
            `${gap.lowestKept.toFixed(4)} and the highest dropped ${gap.highestDropped.toFixed(4)}`,
    );
  }
}

console.log(
  costMicros === undefined
    ? `\nWrote ${chosen.output}. The calls cost an unknown amount: no price is configured for ${config.model}. Set AI_EMBEDDING_PRICE_MICROS.`
    : `\nWrote ${chosen.output}. ${tokens} tokens, about ${(costMicros / 1_000_000).toFixed(6)} US dollars.`,
);
