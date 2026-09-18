#!/usr/bin/env tsx
/**
 * Every pair of models captured so far, in one table.
 *
 *     pnpm --filter @signalscout/engine capture:compare
 *
 * New models keep arriving and each one has to be asked the same two
 * questions before it can go in front of the classifier: **does it refuse
 * anything a person would call a lead**, and **how much does it save**. The
 * captures answer that one pair at a time and write a file each. This reads
 * every file and puts them side by side, so choosing a model is reading a
 * table rather than remembering six runs.
 *
 * It calls nothing and spends nothing. It only reads what the captures wrote,
 * so a pair missing from the table is a pair nobody has measured — which is
 * the other thing this is for.
 *
 * The pinned pair is marked. That is the pair the product sends and the tests
 * assert; everything else is an experiment sitting beside it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pinnedClassifierModel, pinnedTriageModel } from "./pinned.js";

const here = fileURLToPath(new URL(".", import.meta.url));

interface Scores {
  readonly model: string;
  readonly triageModel?: string;
  readonly capturedAt: string;
  readonly threshold: number;
  readonly counts: {
    readonly items: number;
    readonly unscored: number;
    readonly dropped: number;
    readonly kept: number;
    readonly droppedAtOrAboveThreshold: number;
    readonly droppedAtOrAbove60: number;
    readonly keptAtOrAboveThreshold: number;
    readonly highestDropped: number;
  };
  readonly usage: { readonly estimatedCostMicros?: number };
  readonly scored: readonly {
    readonly kind: string;
    readonly id: string;
    readonly kept: boolean;
    readonly score: number | null;
  }[];
}

interface Verdicts {
  readonly model: string;
  readonly capturedAt: string;
  readonly counts: {
    readonly comments: number;
    readonly commentsKept: number;
    readonly asking: number;
    readonly askingKept: number;
    readonly answering: number;
    readonly answeringKept: number;
  };
  readonly usage: { readonly estimatedCostMicros?: number };
}

const files = readdirSync(here);

const verdictsByModel = new Map<string, Verdicts>();
for (const file of files) {
  const match = /^triage-verdicts-(.+)\.json$/.exec(file);
  if (!match) continue;

  verdictsByModel.set(
    match[1] as string,
    JSON.parse(readFileSync(`${here}${file}`, "utf8")) as Verdicts,
  );
}

const pairs: { classifier: string; triage: string; scores: Scores }[] = [];
for (const file of files) {
  const match = /^triage-scores-(.+)-by-(.+)\.json$/.exec(file);
  if (!match) continue;

  pairs.push({
    classifier: match[1] as string,
    triage: match[2] as string,
    scores: JSON.parse(readFileSync(`${here}${file}`, "utf8")) as Scores,
  });
}

if (pairs.length === 0) {
  console.log(
    "No pair has been captured yet. Run capture:triage and then capture:scores; " +
      "docs/instruments.md has the loop.",
  );
  process.exit(0);
}

console.log(
  `${pairs.length} pair(s) captured over the same 50 hand-labelled items. ` +
    "A * marks the pinned pair, which is the one the product sends.\n",
);

const head = [
  "triage".padEnd(18),
  "classifier".padEnd(18),
  "kept".padStart(5),
  "leads".padStart(6),
  "top drop".padStart(9),
  "junk kept".padStart(10),
  "triage $".padStart(9),
  "captured".padStart(11),
].join("  ");
console.log(head);
console.log("-".repeat(head.length));

for (const pair of pairs.sort((a, b) => a.triage.localeCompare(b.triage))) {
  const { counts, scored } = pair.scores;
  const leads = scored.filter((row) => row.kind === "post" && row.id !== "low-intent");
  const leadsKept = leads.filter((row) => row.kept).length;
  const junkKept = counts.kept - counts.keptAtOrAboveThreshold;
  const verdicts = verdictsByModel.get(pair.triage);
  const triageCost = verdicts?.usage.estimatedCostMicros;
  const pinned =
    pair.triage === pinnedTriageModel && pair.classifier === pinnedClassifierModel ? "*" : " ";

  console.log(
    [
      `${pinned}${pair.triage}`.padEnd(18),
      pair.classifier.padEnd(18),
      `${counts.kept}/${counts.items}`.padStart(5),
      `${leadsKept}/${leads.length}`.padStart(6),
      String(counts.highestDropped).padStart(9),
      String(junkKept).padStart(10),
      (triageCost === undefined ? "—" : `$${(triageCost / 1_000_000).toFixed(4)}`).padStart(9),
      pair.scores.capturedAt.slice(0, 10).padStart(11),
    ].join("  "),
  );
}

console.log(
  "\nkept      — items that bought a classification. Lower is cheaper." +
    "\nleads     — worked examples PLAN.md scores as leads that survived. **This must not fall.**" +
    "\ntop drop  — the highest score triage refused. Above 60 is a deleted lead." +
    "\njunk kept — kept items scoring below the threshold: the saving still on the table.",
);

const unmeasured = [...verdictsByModel.keys()].filter(
  (model) => !pairs.some((pair) => pair.triage === model),
);
if (unmeasured.length > 0) {
  console.log(
    `\nTriaged but never scored: ${unmeasured.join(", ")}. ` +
      "A keep rate without scores cannot say whether the drops were right.",
  );
}
