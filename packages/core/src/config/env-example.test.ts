import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { builtInSources } from "../sources/index.js";
import { environmentVariableFor } from "../worker/credentials.js";
import { envSchema } from "./env.js";

/**
 * Correctness-critical: a variable a person sets and nothing reads.
 *
 * There are two example files and they have different jobs. `.env.example` is
 * the reference — `config/env.ts` says it is the human-readable copy of the
 * schema, so a setting that exists and is written down nowhere is the failure
 * it guards. `.env.example.self-hosted` is the starting point `pnpm setup`
 * copies, and its failure is the opposite one: a name that survived a rename
 * and now sets nothing, in the file read by the person with the least context
 * to notice.
 *
 * Both enumerate rather than sample, for the reason `compose-environment.ts`
 * gives beside it: the variable added next month is the one nobody checks.
 */

function exampleFile(name: string): string {
  return readFileSync(new URL(`../../../../${name}`, import.meta.url), "utf8");
}

/** Every `NAME=` an example file declares. */
function declaredBy(name: string): Set<string> {
  const names = new Set<string>();

  for (const line of exampleFile(name).split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line.trim());
    if (match?.[1]) names.add(match[1]);
  }

  return names;
}

/**
 * The credential variables, derived rather than listed.
 *
 * `config/env.ts` does not declare these: the set is one per credential field
 * per registered connector and is not known until the registry is built. So
 * adding a connector must add no case here either.
 */
function providerVariables(): Set<string> {
  const names = new Set<string>();

  for (const connector of builtInSources) {
    for (const field of connector.provider.credentialFields) {
      names.add(environmentVariableFor(connector.provider.id, field.name));
    }
  }

  return names;
}

/**
 * Read by a compose file rather than by the application, so the schema cannot
 * vouch for them. A reason per entry, so an addition is a decision somebody
 * wrote down.
 */
const composeOnly = new Map([
  ["POSTGRES_USER", "docker-compose.yml builds DATABASE_URL from it"],
  ["POSTGRES_PASSWORD", "docker-compose.yml builds DATABASE_URL from it"],
  ["POSTGRES_DB", "docker-compose.yml builds DATABASE_URL from it"],
  ["COMPOSE_PROFILES", "read by Compose itself, to start the worker container"],
  ["SIGNALSCOUT_IMAGE", "the published image the compose file pulls"],
  ["APP_HOST", "docker-compose.prod.yml routes on it"],
  ["ACME_EMAIL", "docker-compose.proxy.yml gets a certificate with it"],
  ["EDGE_NETWORK", "the network the proxy and the app meet on"],
  ["TRAEFIK_NAME", "names this stack's router and service"],
  ["ROBOTS_TAG", "what the proxy answers in X-Robots-Tag"],
  ["TRAEFIK_BASIC_AUTH_USERS", "docker-compose.staging.yml's password prompt"],
]);

/**
 * Settings that must not appear in the short file.
 *
 * Not a style rule. Each one is the hosted shape: a self-hoster who meets
 * `BILLING_MODE` on their first install is being asked to decide whether to
 * charge themselves, and `ADMIN_EMAILS` reads as a thing to fill in when
 * filling it in is what opens every account's data to an address.
 */
const cloudOnly = [
  "BILLING_MODE",
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID",
  "STRIPE_WEBHOOK_SECRET",
  "APP_URL",
  "ADMIN_EMAILS",
  "AUTH_URL",
  "AUTH_TRUSTED_ORIGINS",
  "TRAEFIK_NAME",
  "TRAEFIK_BASIC_AUTH_USERS",
  "ROBOTS_TAG",
  "EDGE_NETWORK",
];

/**
 * Whether git would commit a path. Exit 1 means no rule ignores it.
 *
 * Asked of git rather than by reading `.gitignore` here, because the matching
 * — negations, the order rules are applied in, whether a later pattern wins —
 * is the part that goes wrong, and reimplementing it would reproduce the
 * mistake rather than catch it.
 */
function isIgnoredByGit(name: string): boolean {
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  return spawnSync("git", ["check-ignore", "-q", name], { cwd: repository }).status === 0;
}

/**
 * `.env.*` ignores everything, and each example is un-ignored by name.
 *
 * `.env.example.self-hosted` was invisible to git for as long as it took to
 * notice: the whole suite passed, the install worked on this machine, and a
 * clone would have had `pnpm setup` copy a file that was never committed. A
 * test that reads a file says nothing about whether anybody else will have it.
 */
describe("the example files", () => {
  it("are not ignored by git", () => {
    expect(isIgnoredByGit(".env.example")).toBe(false);
    expect(isIgnoredByGit(".env.example.self-hosted")).toBe(false);
  });

  it("are un-ignored by name, so a real `.env.` file still is", () => {
    // Guards the guard: a `!.env.example*` that let a copied-and-filled-in
    // `.env.example.local` through would pass the case above.
    expect(isIgnoredByGit(".env")).toBe(true);
    expect(isIgnoredByGit(".env.example.local")).toBe(true);
  });
});

describe(".env.example", () => {
  it("names every variable the schema declares", () => {
    const declared = declaredBy(".env.example");

    // Guards the guard: a regex that stopped matching would pass silently.
    expect(declared.size).toBeGreaterThan(0);

    const missing = Object.keys(envSchema.shape).filter((name) => !declared.has(name));
    expect(missing).toEqual([]);
  });

  it("names the credential variable of every provider in the registry", () => {
    const declared = declaredBy(".env.example");
    const expected = providerVariables();

    expect(expected.size).toBeGreaterThan(0);
    expect([...expected].filter((name) => !declared.has(name))).toEqual([]);
  });
});

describe(".env.example.self-hosted", () => {
  it("names nothing the application and the compose files do not read", () => {
    const declared = declaredBy(".env.example.self-hosted");
    const read = new Set([
      ...Object.keys(envSchema.shape),
      ...providerVariables(),
      ...composeOnly.keys(),
    ]);

    expect(declared.size).toBeGreaterThan(0);
    expect([...declared].filter((name) => !read.has(name))).toEqual([]);
  });

  it("leaves the hosted settings out", () => {
    const declared = declaredBy(".env.example.self-hosted");

    expect(cloudOnly.filter((name) => declared.has(name))).toEqual([]);
  });

  it("stays shorter than the reference beside it", () => {
    // The whole reason it exists. A file that grew back to sixty-six variables
    // would pass every other case here and help nobody.
    expect(declaredBy(".env.example.self-hosted").size).toBeLessThan(
      declaredBy(".env.example").size / 2,
    );
  });

  it("carries what `scripts/init-env.mjs` reads back out of it", () => {
    const declared = declaredBy(".env.example.self-hosted");

    // The two it generates, and the password it says is still the default.
    // A file missing that line makes the warning silent rather than wrong.
    expect(declared).toContain("AUTH_SECRET");
    expect(declared).toContain("ENCRYPTION_KEY");
    expect(declared).toContain("POSTGRES_PASSWORD");
  });

  it("carries a DATABASE_URL, because `pnpm dev` and `pnpm test` need one", () => {
    // Inside compose the app builds its own from the Postgres settings, so
    // this line is only for the processes that run on the host — and they are
    // the ones started by the same file.
    expect(declaredBy(".env.example.self-hosted")).toContain("DATABASE_URL");
  });

  it("names a source key and a model key, which are what the product needs", () => {
    const declared = declaredBy(".env.example.self-hosted");

    // A provider key buys the conversations and a model key reads them. An
    // instance holding neither can do nothing at all.
    expect([...providerVariables()].some((name) => declared.has(name))).toBe(true);
    expect(declared).toContain("AI_API_KEY");
  });
});
