#!/usr/bin/env node
/**
 * Write a `.env` this instance can boot with.
 *
 * Two values in `.env.example` are empty and cannot be anything else: a secret
 * committed to git is a secret every reader of this repository holds. Both are
 * generated here.
 *
 * This exists because the two documented install paths had different amounts
 * of help. `pnpm dev` generated `AUTH_SECRET` and the Docker path did not, so
 * a self-hoster following the README met a restart loop on their first
 * command, and then — one step further in, past the account they had just
 * made — an onboarding gate that could not store the keys it was asking for.
 * The convenience belonged to the path that needed it least.
 *
 * **Nothing here overwrites a value that is already set.** Re-running it on an
 * instance holding encrypted credentials must be safe, because that is exactly
 * when somebody reaches for it: a value replaced under stored ciphertext is
 * data nobody can read again. Every write is an append, and every append is
 * guarded by a read.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Read a `.env` without a dependency. Only `KEY=value` lines, no expansion. */
export function readEnvFile(path) {
  if (!existsSync(path)) return {};

  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^["']|["']$/g, "")];
      }),
  );
}

/**
 * The two secrets this generates, and what each one costs to lose.
 *
 * `AUTH_SECRET` signs the session cookie. The process refuses to start without
 * it, because an instance with no login serves an inbox and a set of
 * money-spending keys to whoever finds the port, and every screen works.
 * Changing it later signs everybody out and nothing worse.
 *
 * `ENCRYPTION_KEY` encrypts the credentials stored in the database. Without
 * it the app boots and then refuses to store the keys the onboarding gate asks
 * for. **Losing it loses those credentials**, which is why the guard above
 * matters more here than for the other one. docs/secrets.md holds the
 * rotation steps.
 */
const generated = [
  { name: "AUTH_SECRET", describe: () => "signs the session cookie" },
  { name: "ENCRYPTION_KEY", describe: () => "encrypts credentials stored in the database" },
];

/** The password `.env.example` ships. Real on nobody's server, and the default. */
const shippedPostgresPassword = "intentwatch";

/**
 * Make `.env` bootable, and report what changed.
 *
 * Returns the lines to print rather than printing them, so `pnpm dev` can say
 * them in its own order and a test can assert on them.
 */
export function ensureEnvFile(root) {
  const envPath = `${root}.env`;
  const notes = [];

  if (!existsSync(envPath)) {
    copyFileSync(`${root}.env.example`, envPath);
    notes.push("Created .env from .env.example.");
  }

  for (const secret of generated) {
    if (readEnvFile(envPath)[secret.name]) continue;

    appendFileSync(envPath, `\n${secret.name}=${randomBytes(32).toString("base64")}\n`);
    notes.push(`Generated ${secret.name} in .env — ${secret.describe()}.`);
  }

  // Said rather than done. Replacing it on an instance whose Postgres volume
  // already exists locks the app out of its own database, and this script
  // cannot tell whether that volume is there.
  if (readEnvFile(envPath).POSTGRES_PASSWORD === shippedPostgresPassword) {
    notes.push(
      "POSTGRES_PASSWORD is still the shipped default. Change it, and " +
        "DATABASE_URL with it, before this reaches a public address.",
    );
  }

  return notes;
}

const root = fileURLToPath(new URL("..", import.meta.url));

// Only when run directly. `pnpm dev` imports `ensureEnvFile` instead.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const note of ensureEnvFile(root)) console.log(note);
  console.log("\n.env is ready. Next: docker compose up");
}
