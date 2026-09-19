#!/usr/bin/env node
/**
 * The items a triage rule is judged on, built from a `live:triage-score` run.
 *
 * **This file exists because a dataset can be wrong and still look right.** The
 * first comparison of Jev against `gpt-5.6-luna` was measured on the run
 * record's `excerpt` field, which `live-triage-vs-score.ts` writes as
 * `row.excerpt.slice(0, 300)`. The triage call it recorded got the whole post.
 * So one model saw a third of what the other saw, every count still added up,
 * and the conclusion was worthless. Nothing in the harness said so.
 *
 * So the text comes from `posts`, never from the record, and the checks below
 * refuse to write a dataset rather than write a misleading one.
 *
 *     node evals/triage/build-dataset.mjs <run-record.json>
 *
 * It calls no model and spends nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));

function readEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
        .map((line) => [
          line.slice(0, line.indexOf("=")).trim(),
          line
            .slice(line.indexOf("=") + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        ]),
    );
  } catch {
    return {};
  }
}

const env = { ...readEnvFile(join(here, "../../.env")), ...process.env };
const recordPath = process.argv[2];

if (!recordPath) {
  console.error("Pass the triage-score run record: node build-dataset.mjs <record.json>");
  process.exit(1);
}

const record = JSON.parse(readFileSync(recordPath, "utf8"));
const scored = record.items.filter((item) => item.status === "scored" && item.score !== null);

const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();

const posts = new Map(
  (
    await client.query("select id, title, excerpt from posts where id = any($1::uuid[])", [
      scored.map((item) => item.postId),
    ])
  ).rows.map((row) => [row.id, row]),
);

const monitors = new Map(
  (
    await client.query(
      `select id, product, ideal_customer as "idealCustomer", problem, signals
         from monitors where id = any($1::uuid[])`,
      [[...new Set(scored.map((item) => item.monitorId))]],
    )
  ).rows.map((row) => [row.id, row]),
);

await client.end();

/**
 * The checks. Each one refuses rather than warns.
 *
 * A warning in a build step is read once and then never again, and the run
 * that ignores it produces numbers nobody can tell apart from good ones.
 */
const problems = [];

const orphans = scored.filter((item) => !posts.has(item.postId));
if (orphans.length > 0) problems.push(`${orphans.length} items have no row in posts`);

const monitorless = scored.filter((item) => !monitors.has(item.monitorId));
if (monitorless.length > 0) problems.push(`${monitorless.length} items have no monitor`);

const truncated = scored.filter(
  (item) => (posts.get(item.postId)?.excerpt.length ?? 0) < item.excerpt.length,
);
if (truncated.length > 0) {
  problems.push(`${truncated.length} items are shorter in the database than in the record`);
}

const empty = scored.filter((item) => (posts.get(item.postId)?.excerpt ?? "").trim() === "");
if (empty.length > 0) problems.push(`${empty.length} items have empty text`);

if (problems.length > 0) {
  console.error("Refusing to write a dataset:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

/**
 * One assertion per item, chosen by what the item is.
 *
 * Every item used to carry all three, and the two that did not apply passed
 * without testing anything — so a rule that kept everything scored 83% and a
 * rule that kept nothing scored about the same. A metric that cannot fail is
 * not a metric.
 */
function assertionsFor(item) {
  const isMatch = item.score >= item.minScore;
  const isLead = item.score >= 60;

  /**
   * One assertion, and no counters.
   *
   * Counters were tried and removed: a `weight: 0` assertion contributes zero
   * to its metric, so every total came back as 0 and `precision` printed 12.
   * promptfoo already reports the denominator — a metric arrives as a score
   * over the number of cases that carried it — so `leadsKept` is 6 over 6
   * without anything counting it.
   */
  if (isLead) {
    return [
      {
        type: "javascript",
        // The failure this whole stage exists to avoid: a lead deleted with no
        // row, no reason and nothing for a person to notice.
        value: "output === 'keep'",
        metric: "leadsKept",
      },
    ];
  }

  if (isMatch) {
    return [{ type: "javascript", value: "output === 'keep'", metric: "matchesKept" }];
  }

  return [{ type: "javascript", value: "output === 'drop'", metric: "wasteAvoided" }];
}

const tests = scored.map((item) => {
  const post = posts.get(item.postId);
  const monitor = monitors.get(item.monitorId);

  return {
    description: `${item.source}/${item.kind} score=${item.score} min=${item.minScore}`,
    vars: {
      product: monitor.product,
      idealCustomer: monitor.idealCustomer,
      problem: monitor.problem,
      // Joined, not an array: promptfoo expands an array variable into one
      // test case per value, which silently ran every item six times and
      // multiplied every count by six.
      signals: monitor.signals.join(", "),
      source: item.source,
      channel: item.channel ?? "",
      title: post.title ?? "",
      text: post.excerpt,
      score: item.score,
      minScore: item.minScore,
      /** What the pinned model answered, for the recorded provider to replay. */
      recordedVerdict: item.verdict ?? "none",
    },
    assert: assertionsFor(item),
  };
});

const out = join(here, "dataset.json");
writeFileSync(out, `${JSON.stringify(tests, null, 2)}\n`);

const leads = tests.filter((t) => t.vars.score >= 60).length;
const matches = tests.filter((t) => t.vars.score >= t.vars.minScore).length;
const longest = Math.max(...tests.map((t) => t.vars.text.length));

console.log(
  `${tests.length} items from ${record.items.length} sampled: ` +
    `${leads} leads, ${matches - leads} other matches, ${tests.length - matches} below minimum.`,
);
console.log(`Longest item ${longest} characters; the record caps its own copy at 300.`);
console.log(`Wrote ${out}`);
