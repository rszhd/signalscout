/**
 * Re-encrypt every stored credential under a new key.
 *
 * The middle step of docs/secrets.md, *Rotating the key*. It reads the old key
 * from `ENCRYPTION_KEY` and the new one from `NEW_ENCRYPTION_KEY`, so neither
 * appears in a shell history as an argument.
 *
 * It is one transaction. Half a rotation is the worst outcome available: some
 * rows on each key and no single key that opens them all.
 *
 * It prints how many rows it changed and never what is in them.
 */
import { loadEnv } from "../config/env.js";
import { createDatabase } from "../db/client.js";
import { generateEncryptionKey, requireEncryptionKey } from "./cipher.js";
import { rotateEncryptionKey } from "./store.js";

const env = loadEnv();

if (!process.env.NEW_ENCRYPTION_KEY?.trim()) {
  process.stderr.write(
    "NEW_ENCRYPTION_KEY is not set.\n\n" +
      "  Generate one:  openssl rand -base64 32\n" +
      `  For example:   NEW_ENCRYPTION_KEY='${generateEncryptionKey()}' pnpm db:rotate-key\n\n` +
      "Then put the same value in ENCRYPTION_KEY and restart. " +
      "See docs/secrets.md, Rotating the key.\n",
  );
  process.exit(1);
}

const from = requireEncryptionKey({ ENCRYPTION_KEY: env.ENCRYPTION_KEY });
const to = requireEncryptionKey({ ENCRYPTION_KEY: process.env.NEW_ENCRYPTION_KEY });

const { db, close } = createDatabase(env.DATABASE_URL);

try {
  const rotated = await rotateEncryptionKey(db, from, to);

  process.stdout.write(
    `${rotated} credential${rotated === 1 ? "" : "s"} re-encrypted.\n` +
      "Set ENCRYPTION_KEY to the new value and restart every process, or the " +
      "next boot will refuse to start.\n",
  );
} finally {
  await close();
}
