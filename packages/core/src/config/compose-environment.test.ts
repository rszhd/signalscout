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

/**
 * The compose file names a default image, and CI decides which tags exist. The
 * two were written a month apart and disagreed: the default asked for
 * `:latest`, and the rule that publishes it was conditional on a repository
 * setting that had since changed, so nothing had ever built it. `docker compose
 * up` — the first command in README.md — failed on a tag that did not exist.
 *
 * Neither file can be checked alone, which is why this reads both.
 */
describe("the default image", () => {
  function workflow(): string {
    return readFileSync(new URL("../../../../.github/workflows/ci.yml", import.meta.url), "utf8");
  }

  /** The tag `docker compose up` pulls when nothing sets SIGNALSCOUT_IMAGE. */
  function defaultImageTag(): string | undefined {
    const match = /\$\{SIGNALSCOUT_IMAGE:-([^}]+)\}/.exec(composeFile());
    return match?.[1]?.split(":").pop();
  }

  /** Every tag CI publishes under a fixed name. */
  function publishedTags(): Set<string> {
    return new Set(
      [...workflow().matchAll(/type=raw,value=([A-Za-z0-9._-]+)/g)].map((match) => match[1] ?? ""),
    );
  }

  it("carries a tag that CI publishes", () => {
    const tag = defaultImageTag();

    // Guards the guard: a regex that stopped matching would pass silently.
    expect(tag).toBeTruthy();
    expect(publishedTags().size).toBeGreaterThan(0);

    expect([...publishedTags()]).toContain(tag);
  });

  it("is published from a named branch rather than from a repository setting", () => {
    // The macro reads a value nobody here controls, and this repository's
    // default branch is not the branch that releases. Matched where it would
    // be USED rather than anywhere in the file, so the comment explaining why
    // it is not used does not trip its own rule.
    expect(workflow()).not.toMatch(/enable=\{\{\s*is_default_branch\s*\}\}/);
  });
});
