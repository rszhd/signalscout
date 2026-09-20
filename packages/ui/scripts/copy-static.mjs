#!/usr/bin/env node
/**
 * The stylesheets and the mark, into `dist`.
 *
 * `tsc` emits JavaScript and declarations and nothing else, so a published
 * package whose build was `tsc` alone would export `./tokens.css` from a file
 * that is not there — and the failure lands on the consumer at build time
 * rather than here. The `development` condition reads the same files out of
 * `src`, which is why this is needed only for a publish.
 */
import { cp, mkdir } from "node:fs/promises";

const from = new URL("../src/", import.meta.url);
const to = new URL("../dist/", import.meta.url);

for (const folder of ["styles", "assets"]) {
  await mkdir(new URL(folder, to), { recursive: true });
  await cp(new URL(folder, from), new URL(folder, to), { recursive: true });
}
