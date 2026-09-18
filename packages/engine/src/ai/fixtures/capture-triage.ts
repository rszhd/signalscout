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
 *     pnpm --filter @signalscout/pipeline capture:triage
 *     AI_TRIAGE_MODEL=gpt-5.6-luna pnpm --filter @signalscout/pipeline capture:triage
 *
 * Put the results, the model and the date in the ticket that changed the
 * prompt. A number from a run nobody recorded is a comment, and a comment
 * cannot be re-run.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type AiConfig, triageConfigFromEnvironment } from "../config.js";
import { aiEnvSchema } from "../env.js";
import { createTriager } from "../triage.js";
import type { TriageVerdict } from "../triage-prompt.js";
import { buildTriageSystemPrompt } from "../triage-prompt.js";
import { exampleMonitor, labelledExamples } from "./examples.js";
import { type LabelledSubject, labelledSubjects } from "./labelled-subjects.js";

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
 * `--model=` and `--provider=`, because trying a model should not mean editing
 * `.env` and remembering to put it back.
 *
 * New models keep arriving and this is the instrument that says whether one
 * can be trusted in front of the classifier. A flag makes that a one-line
 * experiment; an environment edit makes it a thing to undo, and an undo that
 * is forgotten leaves the next run measuring something nobody meant.
 */
function flag(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
}

const chosen = { model: flag("model"), provider: flag("provider") };
const base: AiConfig = triageConfigFromEnvironment(aiEnvSchema.parse(environment));
const config: AiConfig = {
  ...base,
  ...(chosen.model ? { model: chosen.model } : {}),
  ...(chosen.provider ? { provider: chosen.provider as AiConfig["provider"] } : {}),
};

if (!config.apiKey) {
  console.error("No key. Set AI_API_KEY, or AI_TRIAGE_API_KEY for a separate triage provider.");
  process.exit(1);
}

/**
 * The fifty items, from `labelled-subjects.ts`.
 *
 * They used to be built here. `capture-scores.ts` needs the same fifty in the
 * same order to be able to put a score beside a verdict, and two copies of the
 * list would drift.
 */
type Subject = LabelledSubject;

const subjects = labelledSubjects();

const triager = createTriager({ config });

console.log(
  `Triaging ${subjects.length} items — ${subjects.filter((s) => s.kind === "comment").length} ` +
    `labelled comments and ${labelledExamples.length} worked examples — with ` +
    `${config.provider}/${config.model}.\n`,
);

/**
 * One recorded answer. `item` is the triage half of the subject and nothing
 * else: the classification half carries a `Date` and a thread, and a fixture
 * that serialised those would be twice the size and read as evidence about a
 * call that never happened here.
 */
interface Answer {
  readonly kind: Subject["kind"];
  readonly thread: string;
  readonly id: string;
  readonly role: Subject["role"];
  readonly item: Subject["forTriage"];
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
  const outcome = await triager.triage({ monitor: exampleMonitor, post: subject.forTriage });

  inputTokens += outcome.call.inputTokens ?? 0;
  outputTokens += outcome.call.outputTokens ?? 0;
  if (outcome.call.estimatedCostMicros === undefined) priced = false;
  else costMicros += outcome.call.estimatedCostMicros;

  answers.push({
    kind: subject.kind,
    thread: subject.thread,
    id: subject.id,
    role: subject.role,
    item: subject.forTriage,
    verdict: outcome.verdict,
    status: outcome.status,
    inputTokens: outcome.call.inputTokens,
    outputTokens: outcome.call.outputTokens,
    costMicros: outcome.call.estimatedCostMicros,
  });

  console.log(
    `  ${(outcome.verdict ?? outcome.status).padEnd(6)} ${(subject.role ?? subject.kind).padEnd(10)}` +
      ` ${subject.id.padEnd(18)} ${subject.forTriage.excerpt.replace(/\s+/g, " ").slice(0, 72)}`,
  );
}

const comments = answers.filter((answer) => answer.kind === "comment");
const asking = comments.filter((answer) => answer.role === "asking");
const answering = comments.filter((answer) => answer.role === "answering");
const neither = comments.filter((answer) => answer.role === "neither");
const kept = (rows: readonly Answer[]) => rows.filter((row) => row.verdict !== "no").length;

/**
 * The prompt these answers were given, as a hash. US-223.
 *
 * A recorded verdict is evidence only while the prompt that produced it is the
 * prompt the product sends. Edit this one and every number in the fixture
 * becomes a claim about a prompt that no longer exists — and nothing would say
 * so, because the file still parses and the counts still add up.
 * `triage-examples.test.ts` compares this and goes red instead.
 */
const promptHash = createHash("sha256")
  .update(`${config.model}\n${buildTriageSystemPrompt(exampleMonitor)}`)
  .digest("hex")
  .slice(0, 16);

const record = {
  provider: config.provider,
  model: config.model,
  promptHash,
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

/**
 * One file per model, never one file overwritten.
 *
 * A second model used to erase the first, which made the one comparison this
 * instrument exists for — is the new model safe enough to put in front of the
 * classifier — impossible without re-buying the old answers.
 */
const outFile = `triage-verdicts-${config.model}.json`;
writeFileSync(`${here}${outFile}`, `${JSON.stringify(record, null, 2)}\n`);

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
  `\nWrote ${outFile}. ${inputTokens} input and ${outputTokens} output tokens, ` +
    (priced
      ? `about ${(costMicros / 1_000_000).toFixed(6)} US dollars.`
      : `cost unknown: no price is configured for ${config.model}.`),
);
