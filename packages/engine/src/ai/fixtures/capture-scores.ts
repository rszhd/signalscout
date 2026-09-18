#!/usr/bin/env tsx
/**
 * Score every item triage answered, so a drop can be read against a score.
 *
 * US-221 made triage stricter and measured the saving: 13 of 46 comments kept
 * where 19 were kept before. That number says the stage drops more. It cannot
 * say whether it drops the **right** ones, because a dropped item leaves no
 * row and nothing to compare. This is the instrument that answers it: classify
 * all fifty, with the real classifier and the real prompt, and put the score
 * beside the verdict.
 *
 * Two questions, and they are not the same.
 *
 * **Did triage delete a lead?** The scores of the items it refused. One of
 * them at or above the monitor's threshold is a lead the product would have
 * shown and now never will, and it is the only kind of fault here that a
 * person can never notice in production.
 *
 * **Did triage earn its place?** The scores of the items it kept. A kept item
 * that scores far below the threshold is a classification the stage was
 * supposed to save and did not.
 *
 * It reads `triage-verdicts-<triage model>.json`, so run `capture:triage` first and run this
 * against the verdicts it wrote. Both read `labelled-subjects.ts`, so the
 * fifty are the same fifty in the same order.
 *
 * **A score is scored once and then reused.** Triage feeds the classifier
 * nothing — it decides only whether the call happens — so a score belongs to
 * the item, the monitor and the classifier's prompt, and never to the verdict.
 * Paying again when only the triage prompt moved buys the same answer with
 * noise on it: two runs over these fifty on one day differed by 2.4 points an
 * item and by 11 points on one of them, which is drift a reader would other
 * wise read as triage having changed something.
 *
 * So each item is cached under a hash of the exact system prompt the
 * classifier was sent, plus the model. Edit `prompt.ts`, change the monitor or
 * change the model and the hash changes, every cached score falls away and the
 * run pays again — without anybody having to remember. `--rescore` forces it.
 *
 * It spends money the first time: fifty classifications with the configured
 * classifier.
 * `gpt-5.6-luna` is about 250 micro-dollars each and `gpt-5.6-terra` about
 * 2800, so the run is about a cent and a half, or about fourteen cents.
 *
 *     pnpm --filter @signalscout/engine capture:scores
 *     AI_MODEL=gpt-5.6-terra pnpm --filter @signalscout/engine capture:scores
 *
 * Put the results, the model and the date in the ticket. It writes
 * `triage-scores-<model>.json`, one file per model, because the answer is
 * about a pair of models and overwriting one with the other loses the pair.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultMinimumScore } from "../../vocabulary.js";
import { createClassifier } from "../classify.js";
import { type AiConfig, aiConfigFromEnvironment } from "../config.js";
import { aiEnvSchema } from "../env.js";
import { buildSystemPrompt } from "../prompt.js";
import { exampleMonitor } from "./examples.js";
import { labelledSubjects } from "./labelled-subjects.js";
import { pinnedTriageModel } from "./pinned.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../../", import.meta.url));

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

/**
 * `--model=`, `--provider=` and `--triage-model=`, for the same reason
 * `capture-triage.ts` takes them: trying a new model should be one run, not an
 * edit to `.env` that somebody has to remember to undo.
 *
 * `--triage-model=` chooses **which verdicts to read**, not which model to
 * call. This instrument calls the classifier only; the verdicts already exist
 * in a file. It defaults to the pinned triage model, so the everyday run joins
 * the two halves the product really runs.
 */
function flag(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
}

const base: AiConfig = aiConfigFromEnvironment(aiEnvSchema.parse(environment));
const chosenModel = flag("model");
const chosenProvider = flag("provider");
const config: AiConfig = {
  ...base,
  ...(chosenModel ? { model: chosenModel } : {}),
  ...(chosenProvider ? { provider: chosenProvider as AiConfig["provider"] } : {}),
};
const triageModel = flag("triage-model") ?? pinnedTriageModel;

if (!config.apiKey) {
  console.error("No key. Set AI_API_KEY.");
  process.exit(1);
}

/** What `capture-triage.ts` wrote, as much of it as this file reads. */
interface CapturedTriage {
  readonly provider: string;
  readonly model: string;
  readonly capturedAt: string;
  readonly answers: readonly {
    readonly id: string;
    readonly verdict: "no" | "maybe" | "yes" | null;
  }[];
}

const verdictsFile = `triage-verdicts-${triageModel}.json`;

if (!existsSync(`${here}${verdictsFile}`)) {
  console.error(
    `No ${verdictsFile}. Run capture:triage --model=${triageModel} first: this instrument ` +
      "scores the items, it does not triage them.",
  );
  process.exit(1);
}

const verdicts = JSON.parse(readFileSync(`${here}${verdictsFile}`, "utf8")) as CapturedTriage;
const verdictOf = new Map(verdicts.answers.map((answer) => [answer.id, answer.verdict]));

interface Scored {
  readonly kind: "comment" | "post";
  readonly id: string;
  readonly role: "asking" | "answering" | "neither" | null;
  readonly verdict: "no" | "maybe" | "yes" | null;
  readonly kept: boolean;
  readonly status: string;
  readonly score: number | null;
  readonly relevance?: number;
  readonly problemFit?: number;
  readonly icpFit?: number;
  readonly intent?: number;
  readonly urgency?: number;
  readonly excerpt: string;
}

const subjects = labelledSubjects();
const classifier = createClassifier({ config });

/**
 * The cache key: the exact prompt this model was sent.
 *
 * Not a version number somebody bumps. The system prompt holds the monitor and
 * every scoring instruction, so hashing it catches an edit to `prompt.ts`, a
 * changed monitor and a reworded dimension alike, and catches them on the run
 * after the edit rather than the release after it.
 */
const promptHash = createHash("sha256")
  .update(`${config.model}\n${buildSystemPrompt(exampleMonitor)}`)
  .digest("hex")
  .slice(0, 16);

const rescore = process.argv.includes("--rescore");
/**
 * One file per pair of models, because the answer is about a pair.
 *
 * A verdict from one triage model and a score from one classifier is a fact
 * about those two together. Overwriting either name loses the comparison the
 * next model is judged against.
 */
const file = `triage-scores-${config.model}-by-${triageModel}.json`;

/**
 * What any previous run scored under this same prompt, whichever triage model
 * it was joined with.
 *
 * The first version read only its own output file, whose name carries the
 * triage model. So trying a second triage model looked like a first run and
 * re-bought all fifty classifications — the exact waste the cache exists to
 * stop, and it cost two cents to learn.
 *
 * The score does not depend on the verdict. Triage feeds the classifier
 * nothing; it decides only whether the call happens. So every
 * `triage-scores-<this model>-by-*.json` holds the same scores for the same
 * items, and any of them under the same prompt hash will do.
 */
const cached = new Map<string, Scored>();

if (!rescore) {
  for (const candidate of readdirSync(here)) {
    if (!candidate.startsWith(`triage-scores-${config.model}-by-`)) continue;

    const previous = JSON.parse(readFileSync(`${here}${candidate}`, "utf8")) as {
      promptHash?: string;
      scored?: readonly Scored[];
    };
    if (previous.promptHash !== promptHash) continue;

    for (const row of previous.scored ?? []) {
      if (row.score !== null && !cached.has(row.id)) cached.set(row.id, row);
    }
  }
}

console.log(
  `Scoring ${subjects.length} items with ${config.provider}/${config.model}, against triage ` +
    `answers from ${verdicts.model} on ${verdicts.capturedAt.slice(0, 10)}.\n`,
);

const scored: Scored[] = [];
let inputTokens = 0;
let outputTokens = 0;
let costMicros = 0;
let priced = true;

let reused = 0;

for (const subject of subjects) {
  const verdict = verdictOf.get(subject.id) ?? null;
  const excerpt = subject.forTriage.excerpt.replace(/\s+/g, " ");

  /**
   * The verdict is always today's; only the score is reused.
   *
   * A cached row carries the verdict of the run that scored it, and that is
   * the one thing this instrument is watching move.
   */
  const previous = cached.get(subject.id);
  if (previous && previous.score !== null) {
    const row: Scored = { ...previous, verdict, kept: verdict !== "no", excerpt };
    scored.push(row);
    reused += 1;

    console.log(
      `  ${String(row.score).padStart(6)}  ${(verdict ?? "—").padEnd(5)} ` +
        `${(subject.role ?? subject.kind).padEnd(10)} ${subject.id.padEnd(18)} ` +
        `${excerpt.slice(0, 54)}  (cached)`,
    );
    continue;
  }

  const outcome = await classifier.classify({
    monitor: exampleMonitor,
    post: subject.forClassification,
  });

  inputTokens += outcome.call.inputTokens ?? 0;
  outputTokens += outcome.call.outputTokens ?? 0;
  if (outcome.call.estimatedCostMicros === undefined) priced = false;
  else costMicros += outcome.call.estimatedCostMicros;

  const row: Scored = {
    kind: subject.kind,
    id: subject.id,
    role: subject.role,
    verdict,
    kept: verdict !== "no",
    status: outcome.status,
    score: outcome.status === "scored" ? outcome.score : null,
    ...(outcome.status === "scored"
      ? {
          relevance: Math.round(outcome.classification.relevance),
          problemFit: Math.round(outcome.classification.problemFit),
          icpFit: Math.round(outcome.classification.icpFit),
          intent: Math.round(outcome.classification.intent),
          urgency: Math.round(outcome.classification.urgency),
        }
      : {}),
    excerpt,
  };
  scored.push(row);

  console.log(
    `  ${String(row.score ?? outcome.status).padStart(6)}  ${(verdict ?? "—").padEnd(5)} ` +
      `${(subject.role ?? subject.kind).padEnd(10)} ${subject.id.padEnd(18)} ` +
      `${excerpt.slice(0, 62)}`,
  );
}

const answered = scored.filter((row): row is Scored & { score: number } => row.score !== null);
const dropped = answered.filter((row) => row.verdict === "no");
const kept = answered.filter((row) => row.kept);

const threshold = defaultMinimumScore;
const atOrAbove = (rows: readonly (Scored & { score: number })[], bar: number) =>
  rows.filter((row) => row.score >= bar);

const record = {
  provider: config.provider,
  model: config.model,
  promptHash,
  capturedAt: new Date().toISOString(),
  note:
    "What the classifier scored for every item triage answered, so a drop can be read against a " +
    "score. The question is whether triage refuses anything the classifier would have called a " +
    `lead. The verdicts come from ${verdictsFile} and the items from labelled-subjects.ts. ` +
    "Two threads and 46 comments is not a distribution.",
  monitor: exampleMonitor,
  triage: { model: verdicts.model, capturedAt: verdicts.capturedAt },
  triageModel,
  threshold,
  counts: {
    items: scored.length,
    unscored: scored.length - answered.length,
    dropped: dropped.length,
    kept: kept.length,
    droppedAtOrAboveThreshold: atOrAbove(dropped, threshold).length,
    droppedAtOrAbove60: atOrAbove(dropped, 60).length,
    keptAtOrAboveThreshold: atOrAbove(kept, threshold).length,
    keptBelowThreshold: kept.length - atOrAbove(kept, threshold).length,
    highestDropped: dropped.reduce((high, row) => Math.max(high, row.score), 0),
  },
  usage: {
    inputTokens,
    outputTokens,
    estimatedCostMicros: priced ? costMicros : undefined,
  },
  scored,
};

writeFileSync(`${here}${file}`, `${JSON.stringify(record, null, 2)}\n`);

const band = (rows: readonly (Scored & { score: number })[]) => {
  const bands = [0, 30, 60, 80];
  return bands
    .map((low, index) => {
      const high = bands[index + 1] ?? 101;
      const count = rows.filter((row) => row.score >= low && row.score < high).length;
      return `${low}–${high - 1}: ${count}`;
    })
    .join("   ");
};

console.log(`\nThreshold is ${threshold}, the default a monitor starts with.`);
console.log(`\nDropped by triage (${dropped.length}): ${band(dropped)}`);
console.log(`Kept by triage   (${kept.length}): ${band(kept)}`);

const lost = atOrAbove(dropped, threshold).sort((a, b) => b.score - a.score);
if (lost.length === 0) {
  console.log(`\nNo item triage refused scores ${threshold} or more. It deleted no lead here.`);
} else {
  console.log(`\n${lost.length} item(s) triage refused would have matched at ${threshold}:`);
  for (const row of lost) {
    console.log(`  ${String(row.score).padStart(3)}  ${row.id}  ${row.excerpt.slice(0, 80)}`);
  }
}

console.log(
  `\n${atOrAbove(kept, threshold).length} of the ${kept.length} it kept scored ${threshold} or ` +
    `more; ${kept.length - atOrAbove(kept, threshold).length} did not and were classified anyway.`,
);

console.log(
  `\n${reused} score(s) reused from the last run under the same prompt; ` +
    `${scored.length - reused} bought now.`,
);

console.log(
  `\nWrote ${file}. ${inputTokens} input and ${outputTokens} output tokens, ` +
    (priced
      ? `about ${(costMicros / 1_000_000).toFixed(6)} US dollars.`
      : `cost unknown: no price is configured for ${config.model}.`),
);
