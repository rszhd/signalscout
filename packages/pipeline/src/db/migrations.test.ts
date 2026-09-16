/**
 * The migration folder agrees with itself. BUG-012.
 *
 * Correctness-critical in the way a build step is: nothing here reads a row,
 * and every failure it catches is a database that is missing something the
 * code believes is there.
 *
 * **A migration file is invisible until its journal entry exists.** The
 * migrator walks `_journal.json`, not the directory, so a hand-written file
 * with no entry is never applied — and `pnpm test` builds its databases the
 * same way, so the whole suite passes against a database missing the column.
 * US-083 spent a round of that: 33 tests failed on `column "is_default" does
 * not exist`, and they only failed at all because the column was read on every
 * path. A column read on one path would have shipped.
 *
 * The snapshot check is the fault that started it. Two snapshots sharing an
 * `id` made `pnpm db:generate` refuse to run for fourteen migrations, which is
 * why they were hand-written, which is why the journal step existed to be
 * forgotten.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inspectMigrationFolder } from "../testing/migrations.js";

const folder = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");

describe("the pipeline's migration folder", () => {
  const report = inspectMigrationFolder(folder);

  it("has a journal entry for every migration file", () => {
    // Named rather than counted: the failure has to say which file, because
    // the person reading it has just written that file and forgotten a step.
    expect(report.unjournaled).toEqual([]);
  });

  it("has a migration file for every journal entry", () => {
    expect(report.missing).toEqual([]);
  });

  /**
   * One migration number, one file — AGENTS.md's rule, as an assertion.
   *
   * Two branches that each take the next number merge cleanly and break at
   * boot, and the merge is where nobody is looking.
   */
  it("numbers each migration once, in order", () => {
    expect(report.numberedInOrder).toBe(true);
  });

  /**
   * No two snapshots claim to be the same one.
   *
   * This is the fault itself: drizzle-kit reads the chain by `id`, and two
   * rows claiming one place made `db:generate` stop before it read the schema.
   * It fails silently in the worst way — the command refuses, everybody writes
   * migrations by hand instead, and the tool that would have caught the next
   * mistake is the one that was turned off.
   */
  it("gives every snapshot its own id", () => {
    expect(report.duplicateSnapshotIds).toEqual([]);
  });
});
