/**
 * The one box in US-004 that is a test and not a review: a decrypted
 * credential never reaches a log line or an error message.
 *
 * Written before the redaction it asserts. The value below is one string,
 * chosen so a leak anywhere in this file is a substring match rather than a
 * judgement about which field a reader was supposed to notice.
 *
 * The third surface — an API response — cannot be asserted from here, because
 * `packages/core` imports neither Fastify nor React. It is asserted in
 * `apps/api/src/credentials-leak.test.ts` against a real server.
 */
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createLogger, redactedFields } from "../logger.js";
import { builtInSources } from "../sources/index.js";
import {
  decryptSecret,
  encryptSecret,
  generateEncryptionKey,
  maskSecret,
  readEncryptionKey,
  UndecryptableSecretError,
} from "./cipher.js";

/** One value, so any leak is a substring match rather than a judgement. */
const secret = "brd_7f3a91c4e08b2d65";
const key = readEncryptionKey(generateEncryptionKey());
const otherKey = readEncryptionKey(generateEncryptionKey());

/** Collect what the logger wrote, as text. */
function captureLines(): { logger: ReturnType<typeof createLogger>; text: () => string } {
  const lines: string[] = [];
  const destination = { write: (line: string) => void lines.push(line) };

  return {
    logger: createLogger({ level: "trace", name: "leak", destination }),
    text: () => lines.join("\n"),
  };
}

describe("a credential never reaches a log line", () => {
  it("redacts a credential logged on its own", () => {
    const { logger, text } = captureLines();

    logger.info({ apiKey: secret }, "polling reddit");

    expect(text()).not.toContain(secret);
    expect(text()).toContain("[redacted]");
  });

  it("redacts a credential logged inside the object a connector is given", () => {
    const { logger, text } = captureLines();

    logger.info({ source: "reddit", credentials: { apiKey: secret } }, "polling reddit");

    expect(text()).not.toContain(secret);
  });

  it("redacts a credential nested one level down", () => {
    const { logger, text } = captureLines();

    logger.info({ request: { apiKey: secret } }, "calling the provider");

    expect(text()).not.toContain(secret);
  });

  it("redacts the encryption key itself", () => {
    const { logger, text } = captureLines();
    const encryptionKey = generateEncryptionKey();

    logger.info({ ENCRYPTION_KEY: encryptionKey }, "starting");

    expect(text()).not.toContain(encryptionKey);
  });

  it("keeps logging everything that is not a credential", () => {
    // A redaction list that swallowed the diagnosis would be its own outage.
    const { logger, text } = captureLines();

    logger.info({ monitorId: "m-1", apiKey: secret }, "poll finished");

    expect(text()).toContain("m-1");
    expect(text()).toContain("poll finished");
  });

  it("names every credential field the shipped connectors ask for", () => {
    // The list is only a guard while it matches the field names in use. A
    // connector added with a field nobody added here logs its key in full.
    for (const source of builtInSources) {
      for (const field of source.credentialFields) {
        expect(redactedFields).toContain(field.name);
      }
    }
  });

  it("is the logger doing this, not the caller", () => {
    // The same line through a bare pino leaks, which is what makes the
    // assertions above a property of createLogger rather than of the input.
    const lines: string[] = [];
    const bare = pino({ level: "trace" }, { write: (line: string) => void lines.push(line) });

    bare.info({ apiKey: secret }, "polling reddit");

    expect(lines.join("\n")).toContain(secret);
  });
});

describe("a credential never reaches an error message", () => {
  it("says nothing of the value when a stored credential cannot be decrypted", () => {
    const stored = encryptSecret(key, secret, "reddit:apiKey");

    try {
      decryptSecret(otherKey, stored, "reddit:apiKey");
      expect.unreachable("the wrong key must not decrypt");
    } catch (error) {
      expect(error).toBeInstanceOf(UndecryptableSecretError);
      // Message, name, stack and every own field: the whole error, the way a
      // crash reporter would serialise it.
      expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(secret);
      expect(String((error as Error).stack)).not.toContain(secret);
    }
  });

  it("says nothing of the value when the stored payload is not ours", () => {
    try {
      // The shape of the mistake this catches: somebody pastes the key itself
      // into the ciphertext column, and the error quotes the column back.
      decryptSecret(key, secret, "reddit:apiKey");
      expect.unreachable("a plaintext payload must be refused");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("logs an undecryptable credential without the ciphertext or the value", () => {
    const { logger, text } = captureLines();
    const stored = encryptSecret(key, secret, "reddit:apiKey");

    try {
      decryptSecret(otherKey, stored, "reddit:apiKey");
    } catch (error) {
      logger.error({ err: error }, "poll refused");
    }

    expect(text()).not.toContain(secret);
    // The record's name is what makes the line worth writing.
    expect(text()).toContain("reddit:apiKey");
  });
});

describe("the masked form", () => {
  it("shows four characters of a credential and no more", () => {
    const masked = maskSecret(secret);

    expect(masked).toBe("••••2d65");
    expect(secret).not.toContain(masked);
  });
});
