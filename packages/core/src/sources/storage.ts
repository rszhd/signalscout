import { sources as storableSourceIds } from "../db/schema.js";
import type { SourceId } from "./types.js";

/**
 * `posts.source` carries a check constraint listing the sources this schema
 * accepts. A connector whose id is not in that list works perfectly until the
 * collector tries to store its first post, which happens on a schedule, at
 * night, inside a job whose failure nobody is watching.
 *
 * The collector calls this at boot, so the mistake surfaces as a process that
 * will not start. Extending the list is a migration; docs/sources.md says so.
 */
export function assertSourcesCanBeStored(ids: Iterable<SourceId>): void {
  const known: readonly string[] = storableSourceIds;
  const unstorable = [...new Set(ids)].filter((id) => !known.includes(id));

  if (unstorable.length === 0) return;

  throw new Error(
    `The posts table has no place for ${unstorable.map((id) => `"${id}"`).join(", ")}. ` +
      `Its source column accepts: ${known.join(", ")}. ` +
      "Extending it is a migration. See docs/sources.md.",
  );
}
