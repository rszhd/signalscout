import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtInSources } from "../sources/index.js";
import { environmentVariableFor } from "../worker/credentials.js";
import { envSchema } from "./env.js";

/**
 * Correctness-critical: a setting the application declares and the container
 * cannot receive.
 *
 * Compose reads `.env` to interpolate values into the lines of the compose
 * file. A variable named nowhere in that file therefore never reaches the
 * container, whatever anybody writes in `.env` — and nothing reports it.
 * `BILLING_MODE=stripe` was unreadable this way: the instance booted in `off`
 * mode, every screen worked, every trial ran out, and the boot check written
 * for exactly that state could not fire because the value never arrived.
 *
 * This enumerates rather than samples, for the reason `auth.test.ts` walks
 * every registered route: the variable added next month is the one nobody
 * checks, and a hand-maintained list of fifty has already drifted once.
 */

/**
 * Declared, and deliberately not carried. A reason per entry, so an omission
 * is a decision somebody wrote down.
 */
const notCarried = new Map([
  ["NODE_ENV", "set by the compose file itself, per service, not by a person"],
  ["HOST", "set by the compose file itself: the container binds 0.0.0.0"],
  ["DATABASE_URL", "built by the compose file from the Postgres settings"],
  ["WEB_DIST_PATH", "addresses a path inside the image; a deployment does not move it"],
  ["WORKER_IN_PROCESS", "set per service, because the app and the worker need different values"],
]);

function composeFile(): string {
  return readFileSync(new URL("../../../../docker-compose.yml", import.meta.url), "utf8");
}

/** Every `NAME:` the compose file passes as an environment key. */
function carriedByCompose(): Set<string> {
  const names = new Set<string>();

  for (const line of composeFile().split("\n")) {
    const match = /^\s{2,}([A-Z][A-Z0-9_]*):\s/.exec(line);
    if (match?.[1]) names.add(match[1]);
  }

  return names;
}

describe("the compose file", () => {
  it("carries every setting the environment schema declares", () => {
    const carried = carriedByCompose();

    const missing = Object.keys(envSchema.shape).filter(
      (name) => !carried.has(name) && !notCarried.has(name),
    );

    expect(missing).toEqual([]);
  });

  it("carries the credential variable of every provider in the registry", () => {
    const carried = carriedByCompose();

    const expected = new Set<string>();
    for (const connector of builtInSources) {
      for (const field of connector.provider.credentialFields) {
        expected.add(environmentVariableFor(connector.provider.id, field.name));
      }
    }

    // Guards the guard: a registry that returned nothing would pass silently.
    expect(expected.size).toBeGreaterThan(0);
    expect([...expected].filter((name) => !carried.has(name))).toEqual([]);
  });

  it("excludes nothing that the schema no longer declares", () => {
    const declared = new Set(Object.keys(envSchema.shape));

    expect([...notCarried.keys()].filter((name) => !declared.has(name))).toEqual([]);
  });
});
