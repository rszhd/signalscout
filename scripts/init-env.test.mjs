/**
 * Correctness-critical: a secret this writes wrongly is an instance with no
 * login, or credentials nobody can decrypt again.
 *
 * Two failure shapes are worth a test each. A value that is *not* written
 * leaves the app refusing to boot, which is loud and recoverable. A value that
 * is written over one that already exists is silent and is not: the session
 * cookie stops verifying, and stored ciphertext stops decrypting for good.
 * So every case here is about the second one.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptionKeyIsWellFormed } from "@signalscout/core";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureEnvFile, readEnvFile } from "./init-env.mjs";

/** A root, with a trailing separator, the way the script is called. */
let root;

function envPath() {
  return join(root, ".env");
}

function writeExample(contents) {
  writeFileSync(join(root, ".env.example"), contents);
}

beforeEach(() => {
  root = `${mkdtempSync(join(tmpdir(), "signalscout-env-"))}/`;
  writeExample("AUTH_SECRET=\nENCRYPTION_KEY=\nPOSTGRES_PASSWORD=intentwatch\n");
});

describe("ensureEnvFile", () => {
  it("writes a .env that has both secrets, from nothing", () => {
    const notes = ensureEnvFile(root);
    const env = readEnvFile(envPath());

    expect(env.AUTH_SECRET).toBeTruthy();
    expect(env.ENCRYPTION_KEY).toBeTruthy();
    expect(notes[0]).toContain("Created .env");
  });

  it("generates a key the application itself accepts", () => {
    ensureEnvFile(root);
    const env = readEnvFile(envPath());

    // The real check `config/env.ts` runs, not this file's own arithmetic. A
    // generator that agrees only with its own test is a generator that writes
    // a value the app refuses at boot.
    expect(encryptionKeyIsWellFormed(env.ENCRYPTION_KEY)).toBe(true);
    // AUTH_SECRET has no format, only a length floor of 32 characters.
    expect(env.AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it("gives the two secrets different values", () => {
    ensureEnvFile(root);
    const env = readEnvFile(envPath());

    // One secret used for both would mean the session secret and the
    // encryption key share a compromise.
    expect(env.AUTH_SECRET).not.toEqual(env.ENCRYPTION_KEY);
  });

  it("keeps a value that is already set, however many times it runs", () => {
    writeFileSync(envPath(), "AUTH_SECRET=mine\nENCRYPTION_KEY=alsomine\n");

    ensureEnvFile(root);
    ensureEnvFile(root);
    const env = readEnvFile(envPath());

    // The case this file exists for: re-running under stored ciphertext.
    expect(env.AUTH_SECRET).toBe("mine");
    expect(env.ENCRYPTION_KEY).toBe("alsomine");
  });

  it("fills only the secret that is missing", () => {
    writeFileSync(envPath(), "ENCRYPTION_KEY=alsomine\n");

    ensureEnvFile(root);
    const env = readEnvFile(envPath());

    expect(env.ENCRYPTION_KEY).toBe("alsomine");
    expect(env.AUTH_SECRET).toBeTruthy();
  });

  it("does not copy the example over a .env that exists", () => {
    writeFileSync(envPath(), "AUTH_SECRET=mine\nENCRYPTION_KEY=alsomine\nAI_MODEL=theirs\n");

    ensureEnvFile(root);

    expect(readEnvFile(envPath()).AI_MODEL).toBe("theirs");
  });

  it("says when the Postgres password is still the shipped default", () => {
    const notes = ensureEnvFile(root);

    expect(notes.join(" ")).toContain("POSTGRES_PASSWORD is still the shipped default");
  });

  it("says nothing about the Postgres password once it is changed", () => {
    writeFileSync(envPath(), "AUTH_SECRET=mine\nENCRYPTION_KEY=x\nPOSTGRES_PASSWORD=chosen\n");

    expect(ensureEnvFile(root).join(" ")).not.toContain("POSTGRES_PASSWORD");
  });

  it("reports each secret it generated, and nothing it did not", () => {
    writeFileSync(envPath(), "AUTH_SECRET=mine\nPOSTGRES_PASSWORD=chosen\n");

    const notes = ensureEnvFile(root).join(" ");

    expect(notes).toContain("Generated ENCRYPTION_KEY");
    expect(notes).not.toContain("Generated AUTH_SECRET");
  });
});

describe("readEnvFile", () => {
  it("is empty for a file that is not there", () => {
    expect(readEnvFile(join(root, "absent"))).toEqual({});
  });

  it("reads a quoted value without its quotes", () => {
    // SOCIALDATA_API_KEY ships quoted, because the key can hold a pipe.
    writeFileSync(envPath(), `SOCIALDATA_API_KEY='a|b'\n`);

    expect(readEnvFile(envPath()).SOCIALDATA_API_KEY).toBe("a|b");
  });

  it("keeps an = inside a value", () => {
    writeFileSync(envPath(), "AUTH_SECRET=abc==\n");

    expect(readEnvFile(envPath()).AUTH_SECRET).toBe("abc==");
  });

  it("skips comments and blank lines", () => {
    writeFileSync(envPath(), "# AUTH_SECRET=commented\n\nAUTH_SECRET=real\n");

    expect(readEnvFile(envPath()).AUTH_SECRET).toBe("real");
  });
});
