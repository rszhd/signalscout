/**
 * The application's migration folder agrees with itself, by the pipeline's
 * rules. US-153. `packages/pipeline/src/db/migrations.test.ts` says why each
 * one exists; this stream is held to them from its first file.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectMigrationFolder } from "@signalscout/pipeline/testing";
import { describe, expect, it } from "vitest";

const folder = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");

describe("the application's migration folder", () => {
  const report = inspectMigrationFolder(folder);

  it("has a journal entry for every migration file", () => {
    expect(report.unjournaled).toEqual([]);
  });

  it("has a migration file for every journal entry", () => {
    expect(report.missing).toEqual([]);
  });

  it("numbers each migration once, in order", () => {
    expect(report.numberedInOrder).toBe(true);
  });

  it("gives every snapshot its own id", () => {
    expect(report.duplicateSnapshotIds).toEqual([]);
  });
});
