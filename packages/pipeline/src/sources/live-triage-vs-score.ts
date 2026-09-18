/**
 * Does triage refuse anything the classifier would have called a lead?
 *
 *     pnpm --filter @signalscout/pipeline live:triage-score [--per-cell=30] [--dry]
 *     … --model=<classifier> --triage-model=<triage> [--rescore]
 *
 * US-221 made triage stricter, and `capture-scores.ts` answered this on the
 * fifty hand-labelled fixtures. Fifty items from two Reddit threads against one
 * example monitor is not a distribution, and the header of every file that
 * touches them says so. This asks the same question of **everything this
 * instance has stored**: every platform, posts and replies, against the
 * monitors the items were really collected for.
 *
 * **Why it cannot be read from the tables.** A triage drop leaves a
 * `filter_drops` row and no score, because the whole point of the stage is that
 * the classification is never bought. So the only way to know what a dropped
 * item was worth is to buy it once, deliberately, here.
 *
 * So every sampled item goes through **both** paid stages, in that order, and
 * the verdict is recorded rather than obeyed: an item triage refuses is
 * classified anyway. That is the difference between this and
 * `live-tiktok-comments.ts`, which runs the real steps and therefore cannot see
 * what the drops were worth.
 *
 * **What the answer looks like.** Two numbers decide it, and they pull apart:
 *
 * - **A drop at or above the monitor's own `min_score`** is a lead this product
 *   would have shown and now never will. Nobody can notice one in production.
 * - **A kept item far below it** is a classification the stage was meant to
 *   save and did not.
 *
 * **The sample is one per platform and kind, not one big draw.** Reddit holds
 * more than half of everything stored, so an untargeted sample would be a
 * Reddit measurement wearing six platforms' names. `--per-cell` is the cap on
 * each of the ten cells; a cell with fewer rows contributes what it has.
 *
 * **A score is bought once and then reused.** Triage feeds the classifier
 * nothing — it decides only whether the call happens — so a score belongs to
 * the item, its monitor and the classifier's prompt, never to the verdict.
 * Paying again when only the triage prompt moved buys the same answer with
 * drift on it, and drift reads as triage having changed something. Each score
 * is cached under a hash of the exact system prompt that monitor's classifier
 * was sent, so editing `prompt.ts`, editing the monitor or changing the model
 * throws the cache away by itself. `--rescore` forces it.
 *
 * The cache holds real people's post text, so it lives beside the run records
 * and `.gitignore` keeps both out of the repository.
 *
 * It spends model money and no provider credit: one triage call per sampled
 * item, and one classification per item that is not already cached. At the prices measured on 2026-09-18 —
 * 273 micro-dollars a triage and about 415 a classification on `gpt-5.6-luna` —
 * 30 per cell is roughly 210 items and about $0.15. `--dry` prints the sample
 * and the estimate and calls nothing.
 *
 * **It writes nothing.** No match, no drop, no `model_calls` row, so the spend
 * is invisible to the budget guard and to every screen. That is deliberate — an
 * instrument that wrote matches would put its own experiment in somebody's
 * inbox — and it is the reason to run it with a number in mind.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  aiConfigFromEnvironment,
  buildSystemPrompt,
  createClassifier,
  createLogger,
  createTriager,
  needsApiKey,
  triageConfigFromEnvironment,
} from "@signalscout/engine";
import { sql } from "drizzle-orm";
import { loadAiEnv } from "../config/env.js";
import { createDatabase } from "../db/client.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("No DATABASE_URL. Start Postgres with `pnpm db:up` and check .env.");
  process.exit(1);
}

const args = process.argv.slice(2);
const perCell = Number(args.find((arg) => arg.startsWith("--per-cell="))?.split("=")[1] ?? 30);
const dry = args.includes("--dry");

/** `worker/classify.ts` cuts a parent to this, and so does this file. */
const parentExcerptLength = 600;

const logger = createLogger({ level: "warn", name: "live-triage-score" });
const { db, close } = createDatabase(databaseUrl);

const aiEnvironment = loadAiEnv(process.env);

/**
 * `--model=` and `--triage-model=`, because this runs often and against models
 * that did not exist last month.
 *
 * New models keep arriving, and the question this instrument answers — is this
 * pair safe, and does it save anything — has to be asked of each of them. A
 * flag makes that one command. An environment edit makes it a thing to undo,
 * and a forgotten undo leaves the next run measuring a pair nobody chose.
 */
function flag(name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
}

const aiConfig = { ...aiConfigFromEnvironment(aiEnvironment) };
const triageConfig = { ...triageConfigFromEnvironment(aiEnvironment) };

const chosenModel = flag("model");
const chosenTriageModel = flag("triage-model");
if (chosenModel) aiConfig.model = chosenModel;
if (chosenTriageModel) triageConfig.model = chosenTriageModel;

if (needsApiKey(aiConfig.provider) && !aiConfig.apiKey) {
  console.error(`No model key for ${aiConfig.provider}. This run would read nothing.`);
  process.exit(1);
}

const classifier = createClassifier({ config: aiConfig });
const triager = createTriager({ config: triageConfig });

const rescore = args.includes("--rescore");
const cacheFile = `triage-score-cache-${aiConfig.model}.json`;

interface CachedScore {
  readonly promptHash: string;
  readonly score: number | null;
  readonly status: string;
}

const scoreCache = new Map<string, CachedScore>(
  !rescore && existsSync(cacheFile)
    ? Object.entries(JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, CachedScore>)
    : [],
);

/**
 * The cache key: this monitor's own system prompt, not a version number.
 *
 * Every monitor sends a different prompt, because the prompt holds the
 * monitor. Hashing the built text catches an edit to `prompt.ts` and an edit
 * to the monitor alike, and catches it on the next run rather than never.
 */
function hashOf(monitor: Parameters<typeof buildSystemPrompt>[0]): string {
  return createHash("sha256")
    .update(`${aiConfig.model}\n${buildSystemPrompt(monitor)}`)
    .digest("hex")
    .slice(0, 16);
}

interface Row {
  readonly postId: string;
  readonly source: string;
  readonly kind: string;
  readonly channel: string | null;
  readonly author: string | null;
  readonly title: string | null;
  readonly excerpt: string;
  readonly postedAt: Date;
  readonly parentTitle: string | null;
  readonly parentExcerpt: string | null;
  readonly aboveExcerpt: string | null;
  readonly monitorId: string;
  readonly monitorName: string;
  readonly product: string;
  readonly idealCustomer: string;
  readonly problem: string;
  readonly signals: string[];
  readonly minScore: number;
}

/**
 * Every (monitor, item) pair this instance has really considered, capped per
 * platform and kind.
 *
 * The pair comes from `matches` and `filter_drops` together, because those two
 * tables are the only record of which monitor a stored post was read for — a
 * post row itself belongs to no monitor. `row_number()` does the per-cell cap
 * in the database rather than reading 1,895 rows to keep 210.
 */
async function sample(): Promise<Row[]> {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    with pairs as (
      select monitor_id, post_id from matches
      union
      select monitor_id, post_id from filter_drops
    ),
    ranked as (
      select
        p.id as post_id, p.source, p.kind, p.channel, p.author, p.title, p.excerpt,
        p.posted_at, p.parent_post_id, p.parent_reply_external_id,
        m.id as monitor_id, m.name as monitor_name, m.product, m.ideal_customer,
        m.problem, m.signals, m.min_score,
        row_number() over (partition by p.source, p.kind order by p.posted_at desc) as seat
      from pairs
      join posts p on p.id = pairs.post_id
      join monitors m on m.id = pairs.monitor_id
      where p.deleted_at is null
    )
    select
      r.*,
      parent.title as parent_title,
      parent.excerpt as parent_excerpt,
      above.excerpt as above_excerpt
    from ranked r
    left join posts parent on parent.id = r.parent_post_id
    left join posts above on above.external_id = r.parent_reply_external_id
    where r.seat <= ${perCell}
    order by r.source, r.kind, r.seat
  `);

  return rows.map((row) => ({
    postId: String(row.post_id),
    source: String(row.source),
    kind: String(row.kind),
    channel: (row.channel as string | null) ?? null,
    author: (row.author as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    excerpt: String(row.excerpt),
    postedAt: new Date(row.posted_at as string),
    parentTitle: (row.parent_title as string | null) ?? null,
    parentExcerpt: (row.parent_excerpt as string | null) ?? null,
    aboveExcerpt: (row.above_excerpt as string | null) ?? null,
    monitorId: String(row.monitor_id),
    monitorName: String(row.monitor_name),
    product: String(row.product),
    idealCustomer: String(row.ideal_customer),
    problem: String(row.problem),
    signals: (row.signals as string[] | null) ?? [],
    minScore: Number(row.min_score),
  }));
}

interface Result extends Row {
  readonly verdict: string | null;
  readonly kept: boolean;
  readonly score: number | null;
  readonly status: string;
}

async function main(): Promise<void> {
  const rows = await sample();

  if (rows.length === 0) {
    console.log("Nothing stored has been read for a monitor yet. Poll something first.");
    return;
  }

  const cells = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.source}/${row.kind}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }

  console.log(
    `${rows.length} items, at most ${perCell} per platform and kind, against ` +
      `${new Set(rows.map((row) => row.monitorId)).size} monitors.`,
  );
  for (const [cell, count] of [...cells].sort()) console.log(`  ${cell.padEnd(18)} ${count}`);
  console.log(
    `\nTriage: ${triageConfig.provider}/${triageConfig.model}. ` +
      `Classifier: ${aiConfig.provider}/${aiConfig.model}.`,
  );
  console.log(
    `Estimated: about $${(((273 + 415) * rows.length) / 1_000_000).toFixed(3)} at the prices ` +
      "measured on 2026-09-18.\n",
  );

  if (dry) {
    console.log("--dry: nothing was called.");
    return;
  }

  const results: Result[] = [];
  let triageMicros = 0;
  let classifyMicros = 0;
  let done = 0;
  let reused = 0;

  for (const row of rows) {
    const monitor = {
      product: row.product,
      idealCustomer: row.idealCustomer,
      problem: row.problem,
      signals: row.signals,
    } as Parameters<typeof triager.triage>[0]["monitor"];

    const triaged = await triager.triage({
      monitor,
      post: {
        source: row.source,
        channel: row.channel,
        // A reply borrows its subject from the post above it, the way
        // `worker/filter.ts` hands triage the parent's title.
        title: row.kind === "reply" ? row.parentTitle : row.title,
        excerpt: row.excerpt,
      },
    });
    triageMicros += triaged.call.estimatedCostMicros ?? 0;

    const promptHash = hashOf(monitor);
    const key = `${row.postId}:${row.monitorId}`;
    const cached = scoreCache.get(key);
    let fromCache = false;
    let score: number | null;
    let status: string;

    if (cached && cached.promptHash === promptHash) {
      score = cached.score;
      status = cached.status;
      fromCache = true;
      reused += 1;
    } else {
      const scored = await classifier.classify({
        monitor,
        post: {
          source: row.source,
          channel: row.channel,
          author: row.author,
          title: row.title,
          excerpt: row.excerpt,
          postedAt: row.postedAt,
          ...(row.kind === "reply" && row.parentTitle !== null
            ? {
                thread: {
                  postTitle: row.parentTitle,
                  postExcerpt: (row.parentExcerpt ?? "").slice(0, parentExcerptLength),
                  ...(row.aboveExcerpt
                    ? { parentReplyExcerpt: row.aboveExcerpt.slice(0, parentExcerptLength) }
                    : {}),
                },
              }
            : {}),
        },
      });

      classifyMicros += scored.call.estimatedCostMicros ?? 0;
      score = scored.status === "scored" ? scored.score : null;
      status = scored.status;
      scoreCache.set(key, { promptHash, score, status });
    }

    const result: Result = {
      ...row,
      verdict: triaged.verdict,
      kept: triaged.kept,
      score,
      status,
    };
    results.push(result);

    done += 1;
    const flag = !result.kept && (result.score ?? 0) >= row.minScore ? " <- DROPPED A MATCH" : "";
    console.log(
      `  ${String(done).padStart(3)}/${rows.length}  ` +
        `${String(result.score ?? status).padStart(6)}${fromCache ? "*" : " "} ` +
        `${(result.verdict ?? "—").padEnd(5)} ${`${row.source}/${row.kind}`.padEnd(16)} ` +
        `${row.excerpt.replace(/\s+/g, " ").slice(0, 46).padEnd(46)}${flag}`,
    );
  }

  writeFileSync(cacheFile, `${JSON.stringify(Object.fromEntries(scoreCache), null, 2)}\n`);
  console.log(
    `\n${reused} score(s) reused from ${cacheFile} under the same prompt; ` +
      `${results.length - reused} bought now. A * marks a reused one.`,
  );

  report(results, triageMicros, classifyMicros);
}

/**
 * The run, as a file.
 *
 * The first run printed and wrote nothing, and its per-item detail was gone
 * the moment the terminal scrolled — which left a summary nobody could
 * re-read and no way to see which items moved when the prompt changed next.
 * The comparison between two runs is the whole point of the loop in
 * `docs/instruments.md`, and it needs both runs on disk.
 *
 * It goes beside the repository rather than into the database, because this
 * instrument writes nothing an account can see.
 */
function writeRecord(
  results: readonly Result[],
  triageMicros: number,
  classifyMicros: number,
): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = `triage-score-${aiConfig.model}-by-${triageConfig.model}-${stamp}.json`;

  writeFileSync(
    file,
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        triage: { provider: triageConfig.provider, model: triageConfig.model },
        classifier: { provider: aiConfig.provider, model: aiConfig.model },
        perCell,
        note:
          "Every sampled item through triage and then classification, with the verdict recorded " +
          "rather than obeyed, so a drop can be read against a score. Nothing was written to the " +
          "database. Each item is scored against the monitor it was really collected for, so the " +
          "bar is that monitor's own min_score and not one global number.",
        spentMicros: { triage: triageMicros, classify: classifyMicros },
        items: results.map((row) => ({
          postId: row.postId,
          source: row.source,
          kind: row.kind,
          monitorId: row.monitorId,
          monitorName: row.monitorName,
          minScore: row.minScore,
          verdict: row.verdict,
          kept: row.kept,
          status: row.status,
          score: row.score,
          channel: row.channel,
          excerpt: row.excerpt.replace(/\s+/g, " ").slice(0, 300),
        })),
      },
      null,
      2,
    )}\n`,
  );

  return file;
}

function report(results: readonly Result[], triageMicros: number, classifyMicros: number): void {
  const answered = results.filter((row): row is Result & { score: number } => row.score !== null);
  const dropped = answered.filter((row) => !row.kept);
  const kept = answered.filter((row) => row.kept);

  const band = (rows: readonly (Result & { score: number })[]) => {
    const edges = [0, 30, 60, 80];
    return edges
      .map((low, index) => {
        const high = edges[index + 1] ?? 101;
        return `${low}–${high - 1}: ${String(
          rows.filter((row) => row.score >= low && row.score < high).length,
        ).padStart(4)}`;
      })
      .join("   ");
  };

  console.log(`\n${"=".repeat(78)}`);
  console.log(`Scored ${answered.length} of ${results.length}. Bands:`);
  console.log(`  dropped by triage (${String(dropped.length).padStart(4)}): ${band(dropped)}`);
  console.log(`  kept by triage    (${String(kept.length).padStart(4)}): ${band(kept)}`);

  console.log("\nBy platform and kind — kept, and how many drops would have matched:");
  const cells = [...new Set(answered.map((row) => `${row.source}/${row.kind}`))].sort();
  for (const cell of cells) {
    const inCell = answered.filter((row) => `${row.source}/${row.kind}` === cell);
    const keptHere = inCell.filter((row) => row.kept);
    const lostHere = inCell.filter((row) => !row.kept && row.score >= row.minScore);
    console.log(
      `  ${cell.padEnd(18)} ${String(keptHere.length).padStart(3)}/${String(inCell.length).padEnd(3)} kept` +
        `   ${String(lostHere.length).padStart(3)} drop(s) at or above the monitor's own minimum`,
    );
  }

  const lost = dropped.filter((row) => row.score >= row.minScore).sort((a, b) => b.score - a.score);

  console.log(`\n${"-".repeat(78)}`);
  if (lost.length === 0) {
    console.log("Triage refused nothing that would have matched. It deleted no lead here.");
  } else {
    console.log(`Triage refused ${lost.length} item(s) that would have matched:`);
    for (const row of lost.slice(0, 25)) {
      console.log(
        `  ${String(row.score).padStart(3)} (min ${String(row.minScore).padStart(2)})  ` +
          `${`${row.source}/${row.kind}`.padEnd(16)} ${row.excerpt.replace(/\s+/g, " ").slice(0, 60)}`,
      );
    }
    if (lost.length > 25) console.log(`  … and ${lost.length - 25} more.`);
  }

  const strong = dropped.filter((row) => row.score >= 60);
  console.log(
    `\n${strong.length} of the ${dropped.length} drops scored 60 or more, which is the band a ` +
      "person would call a good lead.",
  );

  const wasted = kept.filter((row) => row.score < row.minScore);
  console.log(
    `${wasted.length} of the ${kept.length} it kept scored below their monitor's minimum: ` +
      "classifications the stage was meant to save and did not.",
  );

  const file = writeRecord(results, triageMicros, classifyMicros);

  console.log(
    `\nSpent about $${((triageMicros + classifyMicros) / 1_000_000).toFixed(4)} — ` +
      `$${(triageMicros / 1_000_000).toFixed(4)} on triage and ` +
      `$${(classifyMicros / 1_000_000).toFixed(4)} on classification. ` +
      `Nothing was written to the database; the run is in ${file}.`,
  );
}

try {
  await main();
} catch (error) {
  logger.error({ error }, "the run failed");
  console.error(error);
  process.exitCode = 1;
} finally {
  await close();
}
