import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Correctness-critical: staging takes registrations (`AUTH_SIGNUP=open`), so
 * anybody who can reach it may make an account. `docker-compose.staging.yml`
 * puts a basic-auth prompt on the staging router alone.
 *
 * The fault this guards is a merge, not a typo. `docker-compose.prod.yml`
 * serves both stacks and names the router's `middlewares` list. The overlay
 * names that same label again to replace it, and Compose merges labels by key.
 * If the merge ever appends instead, production would receive the prompt too,
 * and with no users configured it would refuse every request there. A text
 * assertion cannot see that, so this renders each stack the way the deploy
 * script does and reads what Traefik will get.
 *
 * The second fault is a password in git. A bcrypt hash starts with `$2y$`, and
 * Compose reads `$` as a variable, so the hash lives in the box's `.env` and
 * the overlay names the variable. This fails if a hash is ever written into the
 * file.
 */

const rootUrl = new URL("../../../../", import.meta.url);
const root = fileURLToPath(rootUrl);

function read(name: string): string {
  return readFileSync(new URL(name, rootUrl), "utf8");
}

function render(files: string[], env: Record<string, string>): string {
  return execFileSync(
    "docker",
    [
      "compose",
      "--env-file",
      "/dev/null",
      "-f",
      "docker-compose.yml",
      ...files.flatMap((file) => ["-f", file]),
      "config",
    ],
    { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" },
  );
}

function stagingConfig(): string {
  return render(["docker-compose.prod.yml", "docker-compose.staging.yml"], {
    TRAEFIK_NAME: "signalscout-staging",
    APP_HOST: "app.signalscout-dev.space",
    TRAEFIK_BASIC_AUTH_USERS: "staging:$2y$05$abcdefghijklmnopqrstuv",
  });
}

function productionConfig(): string {
  return render(["docker-compose.prod.yml"], {
    TRAEFIK_NAME: "signalscout",
    APP_HOST: "app.signalscout.run",
  });
}

describe("the staging password", () => {
  it("puts a basic-auth prompt on the staging router", () => {
    const config = stagingConfig();

    expect(config).toContain("basicauth.users");
    expect(config).toContain(
      "signalscout-staging.middlewares: signalscout-staging-robots@docker,signalscout-staging-basic@docker",
    );
  });

  it("leaves the production router without one", () => {
    const config = productionConfig();

    expect(config).not.toContain("basicauth");
    expect(config).not.toContain("-basic@docker");
    expect(config).toContain("signalscout.middlewares: signalscout-robots@docker");
  });

  it("reads the password from the environment, never from a committed file", () => {
    const overlay = read("docker-compose.staging.yml");

    expect(overlay).toMatch(/basicauth\.users=\$\{TRAEFIK_BASIC_AUTH_USERS/);
    // A real bcrypt hash is `$2y$` and a two-digit cost and 53 more characters.
    // The bare `$2y$` in the comment above is prose and must not trip this.
    expect(overlay).not.toMatch(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{20,}/);
    expect(overlay).not.toMatch(/\$apr1\$[./A-Za-z0-9]{20,}/);
  });

  it("is layered by the staging deploy and not the production one", () => {
    expect(read(".github/workflows/deploy-staging.yml")).toContain("docker-compose.staging.yml");
    expect(read(".github/workflows/deploy-production.yml")).not.toContain(
      "docker-compose.staging.yml",
    );
    expect(read("scripts/deploy-remote.sh")).toMatch(/overlay=\$\{5:-}/);
  });
});
