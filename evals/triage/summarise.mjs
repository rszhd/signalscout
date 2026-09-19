#!/usr/bin/env node
/**
 * The comparison table, from promptfoo's own numbers.
 *
 * **It exists so that nobody reads a figure out of a chat message again.**
 * Every derived number in this file — precision, the classifier bill, the
 * total — was computed by hand at least once while this harness was being
 * built, and two of them were wrong: a confidence floor stated backwards, and
 * a triage total mistaken for a saving. Arithmetic in prose cannot be
 * reviewed, re-run or tested. This can.
 *
 *     pnpm eval:summary
 *
 * It calls no model and spends nothing. It reads the last eval promptfoo
 * stored.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * What one classification costs, in micro-dollars.
 *
 * Measured, not assumed: 95,079 micro-dollars over 115 classifications on the
 * live cloud worker running `deepseek-flash` on 2026-09-19. Override it when
 * the classifier changes, because the whole point of the total column is that
 * triage is only worth what the calls it avoids would have cost.
 */
const classifierMicros = Number(process.env.EVAL_CLASSIFIER_MICROS ?? 827);

const directory = mkdtempSync(join(tmpdir(), "signalscout-eval-"));
const exported = join(directory, "eval.json");

try {
  execFileSync(
    "npx",
    ["promptfoo", "export", "eval", process.argv[2] ?? "latest", "-o", exported],
    {
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, PROMPTFOO_DISABLE_TELEMETRY: "1" },
    },
  );

  const report = JSON.parse(readFileSync(exported, "utf8"));
  const providers = report.results?.prompts ?? [];

  if (providers.length === 0) {
    console.error("That eval has no providers. Run `pnpm eval:triage` first.");
    process.exit(1);
  }

  const rows = providers.map((entry) => {
    const scores = entry.metrics?.namedScores ?? {};
    const counts = entry.metrics?.namedScoresCount ?? {};

    const leadsKept = scores.leadsKept ?? 0;
    const leads = counts.leadsKept ?? 0;
    const matchesKept = scores.matchesKept ?? 0;
    const matches = counts.matchesKept ?? 0;
    const wasteAvoided = scores.wasteAvoided ?? 0;
    const below = counts.wasteAvoided ?? 0;

    // Everything forwarded to the classifier: the matches it kept, plus the
    // items under the minimum it did not drop.
    const wasted = below - wasteAvoided;
    const kept = leadsKept + matchesKept + wasted;
    const triageCost = entry.metrics?.cost ?? 0;

    return {
      // `provider` is the provider; `label` is the prompt's label, which is
      // the same template for every row and made all three read alike.
      label: entry.provider || entry.label || "?",
      leadsKept,
      leads,
      matchesKept,
      matches,
      kept,
      wasted,
      precision: kept > 0 ? (leadsKept + matchesKept) / kept : 0,
      recall: leads + matches > 0 ? (leadsKept + matchesKept) / (leads + matches) : 0,
      triageCost,
      classifierCost: (kept * classifierMicros) / 1_000_000,
    };
  });

  const money = (value) => `$${value.toFixed(4)}`;
  const pad = (value, width) => String(value).padStart(width);

  console.log(
    `\nclassifier priced at ${classifierMicros} micro-dollars a call ` +
      "(EVAL_CLASSIFIER_MICROS to change it)\n",
  );
  console.log(
    `${"rule".padEnd(30)} ${"leads".padEnd(7)} ${"matches".padEnd(9)} ${"fwd".padEnd(5)} ` +
      `${"waste".padEnd(6)} ${"prec".padEnd(6)} ${"recall".padEnd(7)} ${"triage".padEnd(9)} ` +
      `${"classify".padEnd(9)} total`,
  );

  for (const row of rows) {
    console.log(
      `${row.label.slice(0, 30).padEnd(30)} ` +
        `${`${row.leadsKept}/${row.leads}`.padEnd(7)} ` +
        `${`${row.matchesKept}/${row.matches}`.padEnd(9)} ` +
        `${pad(row.kept, 3).padEnd(5)} ` +
        `${pad(row.wasted, 4).padEnd(6)} ` +
        `${`${Math.round(row.precision * 100)}%`.padEnd(6)} ` +
        `${`${Math.round(row.recall * 100)}%`.padEnd(7)} ` +
        `${money(row.triageCost).padEnd(9)} ` +
        `${money(row.classifierCost).padEnd(9)} ` +
        money(row.triageCost + row.classifierCost),
    );
  }

  console.log(
    "\nleads are items the classifier scored 60 or more; matches reach their " +
      "monitor's own minimum.\nfwd is what reached the classifier, waste is how " +
      "much of that scored below the minimum.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
