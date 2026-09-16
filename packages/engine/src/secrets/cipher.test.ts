/**
 * Written before `cipher.ts`. docs/testing.md, *Selective test-first for
 * correctness-critical surfaces*.
 *
 * The expected values here are ones a reader can agree with without opening
 * the implementation: a round trip returns the input, two encryptions of the
 * same input differ, and every way of tampering fails loudly.
 */
import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  generateEncryptionKey,
  InvalidEncryptionKeyError,
  MissingEncryptionKeyError,
  maskSecret,
  readEncryptionKey,
  requireEncryptionKey,
  UndecryptableSecretError,
} from "./cipher.js";

const key = readEncryptionKey(generateEncryptionKey());
const other = readEncryptionKey(generateEncryptionKey());

describe("readEncryptionKey", () => {
  it("accepts a generated key", () => {
    expect(() => readEncryptionKey(generateEncryptionKey())).not.toThrow();
  });

  it("refuses a key that is not 32 bytes, and says how to make one", () => {
    // 16 bytes of base64. AES-256 needs 32, and a shorter key is the mistake
    // somebody makes by pasting half a value.
    const short = Buffer.alloc(16).toString("base64");

    expect(() => readEncryptionKey(short)).toThrow(InvalidEncryptionKeyError);
    expect(() => readEncryptionKey(short)).toThrow(/openssl rand -base64 32/);
  });

  it("refuses a key that is not base64", () => {
    expect(() => readEncryptionKey("not a key")).toThrow(InvalidEncryptionKeyError);
  });

  it("never puts the key it refused in the message", () => {
    const secretLooking = Buffer.alloc(20, 7).toString("base64");

    try {
      readEncryptionKey(secretLooking);
      expect.unreachable("a 20-byte key must be refused");
    } catch (error) {
      expect(String(error)).not.toContain(secretLooking);
    }
  });
});

describe("requireEncryptionKey", () => {
  it("fails when ENCRYPTION_KEY is absent, and says how to make one", () => {
    expect(() => requireEncryptionKey({})).toThrow(MissingEncryptionKeyError);
    expect(() => requireEncryptionKey({})).toThrow(/openssl rand -base64 32/);
  });

  it("treats a present but blank value as absent", () => {
    // `.env.example` is committed with blank values, so blank has to mean
    // unset here exactly as it does in config/env.ts.
    expect(() => requireEncryptionKey({ ENCRYPTION_KEY: "  " })).toThrow(MissingEncryptionKeyError);
  });
});

describe("encryptSecret and decryptSecret", () => {
  it("returns the original value", () => {
    const plaintext = "brd_super_secret_value";
    const stored = encryptSecret(key, plaintext, "reddit:apiKey");

    expect(decryptSecret(key, stored, "reddit:apiKey")).toBe(plaintext);
  });

  it("never stores the plaintext", () => {
    const stored = encryptSecret(key, "brd_super_secret_value", "reddit:apiKey");

    expect(stored).not.toContain("brd_super_secret_value");
    expect(stored).not.toContain("super");
  });

  it("gives each value its own nonce, so the same input encrypts twice differently", () => {
    const first = encryptSecret(key, "same", "reddit:apiKey");
    const second = encryptSecret(key, "same", "reddit:apiKey");

    expect(first).not.toBe(second);
    expect(nonceOf(first)).not.toBe(nonceOf(second));
    expect(decryptSecret(key, first, "reddit:apiKey")).toBe("same");
    expect(decryptSecret(key, second, "reddit:apiKey")).toBe("same");
  });

  it("stores the nonce with the ciphertext", () => {
    const stored = encryptSecret(key, "value", "reddit:apiKey");
    const [version, nonce, ciphertext, tag] = stored.split(".");

    expect(version).toBe("v1");
    // 12 bytes, the size GCM is specified for.
    expect(Buffer.from(nonce ?? "", "base64").byteLength).toBe(12);
    expect(Buffer.from(ciphertext ?? "", "base64").byteLength).toBeGreaterThan(0);
    // 16 bytes of authentication tag.
    expect(Buffer.from(tag ?? "", "base64").byteLength).toBe(16);
  });

  it("round-trips a value that is not ASCII", () => {
    const plaintext = "ключ-🔑-日本語";

    expect(decryptSecret(key, encryptSecret(key, plaintext, "x:apiKey"), "x:apiKey")).toBe(
      plaintext,
    );
  });

  it("refuses the wrong key, and never answers with noise", () => {
    const stored = encryptSecret(key, "value", "reddit:apiKey");

    expect(() => decryptSecret(other, stored, "reddit:apiKey")).toThrow(UndecryptableSecretError);
  });

  it("refuses a tampered ciphertext", () => {
    const stored = encryptSecret(key, "value", "reddit:apiKey");
    const [version, nonce, ciphertext, tag] = stored.split(".");
    const flipped = Buffer.from(ciphertext ?? "", "base64");
    flipped[0] = (flipped[0] ?? 0) ^ 0x01;

    const tampered = [version, nonce, flipped.toString("base64"), tag].join(".");

    expect(() => decryptSecret(key, tampered, "reddit:apiKey")).toThrow(UndecryptableSecretError);
  });

  it("refuses a value encrypted for another record", () => {
    // The record name is authenticated, so a row copied from one source's
    // credential into another's does not decrypt into a working key.
    const stored = encryptSecret(key, "value", "reddit:apiKey");

    expect(() => decryptSecret(key, stored, "x:apiKey")).toThrow(UndecryptableSecretError);
  });

  it("refuses a payload in an unknown format", () => {
    expect(() => decryptSecret(key, "plaintext-that-was-never-encrypted", "reddit:apiKey")).toThrow(
      UndecryptableSecretError,
    );
    expect(() => decryptSecret(key, "v2.a.b.c", "reddit:apiKey")).toThrow(UndecryptableSecretError);
  });

  it("names the record it could not decrypt, and returns nothing", () => {
    const stored = encryptSecret(key, "value", "reddit:apiKey");

    // Never undefined, never "": an empty credential is a poll that fails four
    // times against the provider with a question we could answer here.
    expect(() => decryptSecret(other, stored, "reddit:apiKey")).toThrow(/reddit:apiKey/);
  });
});

describe("maskSecret", () => {
  it("shows the last four characters, so a person can tell which key is set", () => {
    expect(maskSecret("brd_abcdefgh1234")).toBe("••••1234");
  });

  it("shows nothing of a short value", () => {
    // Four of eight characters is most of a short secret. Below that length,
    // a hint is a leak.
    expect(maskSecret("short")).toBe("••••");
    expect(maskSecret("12345678")).toBe("••••5678");
    expect(maskSecret("1234567")).toBe("••••");
  });

  it("shows nothing of an empty value", () => {
    expect(maskSecret("")).toBe("••••");
  });
});

function nonceOf(stored: string): string {
  return stored.split(".")[1] ?? "";
}
