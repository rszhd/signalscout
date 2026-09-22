#!/usr/bin/env node
/**
 * What the verdicts say about the score.
 *
 *   node --env-file=.env scripts/verdicts.mjs             the answer
 *   node --env-file=.env scripts/verdicts.mjs --sample=40 what to judge next
 *   node --env-file=.env scripts/verdicts.mjs --json      the same, for a diff
 *
 * US-033 asks one question — **does a higher score mean a better lead?** — and
 * it has stalled twice because answering it meant inventing SQL after an hour
 * of reading. This prints the answer instead. It reads the database and
 * nothing else: no provider call, no model call, no money.
 *
 * **It does not judge anything.** A verdict is a person reading a conversation
 * and deciding, in the inbox, with the two buttons US-012 put there. This
 * script is what that hour is worth afterwards.
 *
 * The statistic is rank-based on purpose. With tens of verdicts a mean is
 * moved by one outlier and a t-test assumes a shape nobody has checked. The
 * number reported is the probability that a good lead outranks a not-relevant
 * one when both are drawn at random — the Mann-Whitney statistic, which is
 * exactly the question the ticket asks, in one number between 0 and 1. Its
 * p-value is computed exactly by enumeration rather than by a normal
 * approximation, because the samples here are far too small for one.
 */
import { Pool } from "pg";

const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? Number(found.slice(name.length + 3)) : fallback;
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with `node --env-file=.env scripts/verdicts.mjs`.");
  process.exit(2);
}

const pool = new Pool({ connectionString: databaseUrl });

/**
 * The exact one-sided p-value for the Mann-Whitney U statistic.
 *
 * `counts[u]` is how many of the C(n+m, n) possible rankings give that U. It
 * is the standard recurrence, and it is affordable because n and m are tens.
 * Returns the chance of a U at least this extreme when the two groups are
 * drawn from the same distribution — which is what "could this be luck" means.
 */
function exactP(u, n, m) {
  if (n === 0 || m === 0) return null;
  let counts = new Float64Array(n * m + 1);
  counts[0] = 1;
  // Build the distribution of U by adding one observation of each group at a
  // time; `next[k]` accumulates the ways to reach rank sum k.
  for (let i = 1; i <= n; i++) {
    const next = new Float64Array(n * m + 1);
    for (let k = 0; k <= n * m; k++) {
      if (counts[k] === 0) continue;
      for (let j = 0; j <= m; j++) {
        if (k + j > n * m) break;
        next[k + j] += counts[k];
      }
    }
    counts = next;
  }
  const total = counts.reduce((sum, c) => sum + c, 0);
  if (total === 0) return null;
  let atLeast = 0;
  for (let k = Math.ceil(u); k <= n * m; k++) atLeast += counts[k];
  return atLeast / total;
}

/** U, and the probability a random good outranks a random not-relevant. */
function separation(good, bad) {
  let u = 0;
  for (const g of good) {
    for (const b of bad) {
      if (g > b) u += 1;
      else if (g === b) u += 0.5;
    }
  }
  const n = good.length;
  const m = bad.length;
  return { u, auc: n && m ? u / (n * m) : null, p: exactP(u, n, m) };
}

/**
 * The score that separates the two groups best, and the band where they mix.
 *
 * "Best" is the cut with the fewest mistakes in both directions. The band is
 * the honest part: between the lowest good and the highest not-relevant, the
 * score decides nothing.
 */
function boundary(good, bad) {
  if (!good.length || !bad.length) return null;
  const all = [...new Set([...good, ...bad])].sort((a, b) => a - b);
  let best = null;
  for (const cut of all) {
    const missedGood = good.filter((s) => s < cut).length;
    const keptBad = bad.filter((s) => s >= cut).length;
    const wrong = missedGood + keptBad;
    if (best === null || wrong < best.wrong) best = { cut, wrong, missedGood, keptBad };
  }
  const lowestGood = Math.min(...good);
  const highestBad = Math.max(...bad);
  return {
    ...best,
    overlap: lowestGood > highestBad ? null : { from: lowestGood, to: highestBad },
  };
}

const rows = (
  await pool.query(`
    SELECT f.verdict, m.score, p.source, p.kind, mo.name AS monitor, mo.min_score
    FROM feedback f
    JOIN matches m ON m.id = f.match_id
    JOIN posts p ON p.id = m.post_id
    JOIN monitors mo ON mo.id = f.monitor_id
    WHERE f.superseded_at IS NULL
  `)
).rows;

const unjudged = (
  await pool.query(`
    SELECT count(*)::int AS n
    FROM matches m
    WHERE NOT EXISTS (
      SELECT 1 FROM feedback f WHERE f.match_id = m.id AND f.superseded_at IS NULL
    )
  `)
).rows[0].n;

if (flag("sample")) {
  const want = value("sample", 40);
  // Spread the hour across score bands and platforms rather than down the
  // ranking. Judging the top forty says nothing about where the boundary is,
  // because the boundary is not at the top.
  const picked = (
    await pool.query(
      `
      SELECT m.id, m.score, p.source, p.kind, p.url, left(coalesce(p.title, ''), 70) AS title
      FROM (
        SELECT m.*, row_number() OVER (
          PARTITION BY width_bucket(m.score, 0, 100, 5), p.source
          ORDER BY random()
        ) AS seat
        FROM matches m JOIN posts p ON p.id = m.post_id
        WHERE NOT EXISTS (
          SELECT 1 FROM feedback f WHERE f.match_id = m.id AND f.superseded_at IS NULL
        )
      ) m
      JOIN posts p ON p.id = m.post_id
      WHERE m.seat <= $1
      ORDER BY m.score DESC
      LIMIT $2
      `,
      [Math.ceil(want / 10), want],
    )
  ).rows;
  console.log(`${picked.length} to judge, spread across score bands and platforms:\n`);
  for (const r of picked) {
    console.log(
      `${String(r.score).padStart(3)}  ${r.source.padEnd(10)} ${r.kind.padEnd(5)} ${r.title}`,
    );
    console.log(`     ${r.url}`);
  }
  console.log(`\nJudge them in the inbox, then run this without --sample.`);
  await pool.end();
  process.exit(0);
}

const good = rows.filter((r) => r.verdict === "good").map((r) => r.score);
const bad = rows.filter((r) => r.verdict === "not_relevant").map((r) => r.score);

const report = { verdicts: rows.length, good: good.length, notRelevant: bad.length, unjudged };

if (rows.length === 0) {
  console.log("No verdicts yet. Judge some in the inbox, then run this again.");
  console.log(`${unjudged} matches are waiting. \`--sample=40\` says which to read first.`);
  await pool.end();
  process.exit(0);
}

const overall = separation(good, bad);
const cut = boundary(good, bad);
report.separation = overall;
report.boundary = cut;

const lines = [];
lines.push(
  `${rows.length} verdicts: ${good.length} good, ${bad.length} not relevant. ${unjudged} unjudged.`,
);
lines.push("");

lines.push("Does a higher score mean a better lead?");
if (!good.length || !bad.length) {
  lines.push(
    "  Cannot say. Every verdict so far is the same answer, so there is nothing to separate.",
  );
} else {
  const pct = (overall.auc * 100).toFixed(0);
  const verdict =
    overall.auc >= 0.8
      ? "Yes"
      : overall.auc >= 0.65
        ? "Weakly"
        : overall.auc <= 0.5
          ? "No"
          : "Barely";
  lines.push(
    `  ${verdict}. A good lead outscores a not-relevant one ${pct}% of the time (${good.length} against ${bad.length}).`,
  );
  if (overall.p !== null) {
    const chance = (overall.p * 100).toFixed(1);
    lines.push(
      overall.p > 0.05
        ? `  But ${chance}% of the time chance alone would do this well. Not enough verdicts to be sure.`
        : `  Chance alone would do this well ${chance}% of the time, so the ordering is real.`,
    );
  }
}
lines.push("");

lines.push("Where do good and not-relevant stop separating?");
if (!cut) {
  lines.push("  Cannot say without both answers in the sample.");
} else if (cut.overlap === null) {
  lines.push(
    `  They never overlap. Every good scored above every not-relevant; a cut at ${cut.cut} is clean.`,
  );
} else {
  lines.push(`  Between ${cut.overlap.from} and ${cut.overlap.to} the score decides nothing.`);
  lines.push(
    `  The fewest mistakes is a cut at ${cut.cut}: it loses ${cut.missedGood} good and keeps ${cut.keptBad} not relevant.`,
  );
}
const floors = [...new Set(rows.map((r) => r.min_score))].sort((a, b) => a - b);
lines.push(`  The monitors judged here sit at min_score ${floors.join(", ")}.`);
lines.push("");

const breakdown = (key, label) => {
  const groups = [...new Set(rows.map((r) => r[key]))].sort();
  lines.push(`By ${label}:`);
  for (const g of groups) {
    const here = rows.filter((r) => r[key] === g);
    const hGood = here.filter((r) => r.verdict === "good");
    const hBad = here.filter((r) => r.verdict === "not_relevant");
    const s = separation(
      hGood.map((r) => r.score),
      hBad.map((r) => r.score),
    );
    const rate = ((hGood.length / here.length) * 100).toFixed(0);
    const sep = s.auc === null ? "—" : `${(s.auc * 100).toFixed(0)}%`;
    lines.push(
      `  ${String(g).padEnd(12)} ${String(here.length).padStart(3)} judged  ${rate.padStart(3)}% good  separation ${sep}`,
    );
  }
  lines.push("");
};
breakdown("source", "platform");
breakdown("kind", "post or reply");

lines.push("Score against verdict:");
for (const r of [...rows].sort((a, b) => b.score - a.score)) {
  lines.push(
    `  ${String(r.score).padStart(3)}  ${r.verdict === "good" ? "good        " : "not relevant"}  ${r.source} ${r.kind}`,
  );
}

if (flag("json")) console.log(JSON.stringify({ ...report, rows }, null, 2));
else console.log(lines.join("\n"));

await pool.end();
