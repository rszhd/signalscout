/**
 * What `migrations.test.ts` asserts about a migration folder, as a function,
 * so the application's stream is held to the same rules as the pipeline's.
 * US-153. The reasoning is in the pipeline's `db/migrations.test.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Journal {
  entries: { idx: number; tag: string }[];
}

export interface MigrationFolderReport {
  /** Files with no journal entry. Named, because the person reading it just wrote one. */
  readonly unjournaled: string[];
  /** Journal entries with no file. */
  readonly missing: string[];
  /** Whether every `idx` and every four-digit prefix is its own position, in order. */
  readonly numberedInOrder: boolean;
  /** Snapshot ids claimed by more than one file. */
  readonly duplicateSnapshotIds: string[][];
}

export function inspectMigrationFolder(folder: string): MigrationFolderReport {
  const journal = JSON.parse(
    readFileSync(join(folder, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  const files = readdirSync(folder)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const tagged = new Set(journal.entries.map((entry) => `${entry.tag}.sql`));
  const present = new Set(files);

  const numberedInOrder =
    journal.entries.every((entry, index) => entry.idx === index) &&
    journal.entries.every(
      (entry, index) => entry.tag.slice(0, 4) === String(index).padStart(4, "0"),
    );

  const seen = new Map<string, string[]>();
  for (const name of readdirSync(join(folder, "meta")).filter((one) =>
    one.endsWith("_snapshot.json"),
  )) {
    const { id } = JSON.parse(readFileSync(join(folder, "meta", name), "utf8")) as { id: string };
    seen.set(id, [...(seen.get(id) ?? []), name]);
  }

  return {
    unjournaled: files.filter((name) => !tagged.has(name)),
    missing: journal.entries
      .filter((entry) => !present.has(`${entry.tag}.sql`))
      .map((entry) => entry.tag),
    numberedInOrder,
    duplicateSnapshotIds: [...seen.values()].filter((names) => names.length > 1),
  };
}
