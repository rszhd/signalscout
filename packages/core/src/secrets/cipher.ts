/**
 * AES-256-GCM for a value that must survive a database backup leaking.
 *
 * Correctness-critical: credential encryption. docs/testing.md names the
 * failure — a key reaches a log line or an API response — and
 * `cipher.test.ts`, `store.test.ts` and `leak.test.ts` were written before
 * this file.
 *
 * Four decisions shape it.
 *
 * **GCM, not CBC.** GCM authenticates, so a tampered ciphertext fails loudly
 * instead of decrypting to noise that some caller then sends to a provider as
 * a key. Every failure in this file is an exception; none is an empty string.
 *
 * **The record name is authenticated data.** Encryption binds a value to the
 * record that holds it, so a row copied from Reddit's credential into X's does
 * not decrypt. Without that, a swap inside the database is invisible: the
 * cipher would happily return a valid key for the wrong source.
 *
 * **The nonce travels with the ciphertext.** A nonce is not a secret; reusing
 * one is what breaks GCM. So one is generated per encryption and stored beside
 * the value rather than derived from anything.
 *
 * **The format says its own version.** `v1.<nonce>.<ciphertext>.<tag>`, all
 * base64. A payload this file does not recognise is refused, not guessed at.
 * The day the format changes, an old row is identified rather than decrypted
 * into nonsense.
 *
 * Nothing here logs. A value passes through this module and back to its
 * caller, and the errors carry the record's name and never its value.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/** AES-256. */
const keyBytes = 32;
/** The nonce size GCM is specified for. */
const nonceBytes = 12;
/** The full-length GCM authentication tag. */
const tagBytes = 16;
const version = "v1";

/** The one sentence a person who has no key needs. */
const howToGenerate = "Generate one with `openssl rand -base64 32` and set ENCRYPTION_KEY to it.";

/**
 * A validated 32-byte key.
 *
 * A branded object rather than a Buffer, so a caller cannot pass a raw string
 * or an unchecked buffer where a checked key belongs. The only way to make one
 * is `readEncryptionKey`, which is the only place the length is checked.
 */
export interface EncryptionKey {
  readonly bytes: Buffer;
  readonly checked: true;
}

export class MissingEncryptionKeyError extends Error {
  constructor(reason: string) {
    super(`${reason} ${howToGenerate}`);
    this.name = "MissingEncryptionKeyError";
  }
}

export class InvalidEncryptionKeyError extends Error {
  constructor(reason: string) {
    super(`ENCRYPTION_KEY ${reason}. ${howToGenerate}`);
    this.name = "InvalidEncryptionKeyError";
  }
}

/**
 * A stored value that did not come back.
 *
 * It names the record and never the value, because there is no value: the
 * point of this error is that we could not produce one. The caller's only
 * correct response is to stop, which is why this is thrown rather than
 * returned.
 */
export class UndecryptableSecretError extends Error {
  constructor(
    readonly record: string,
    reason: string,
  ) {
    super(
      `Cannot decrypt ${record}: ${reason}. ` +
        "The value was written with a different ENCRYPTION_KEY, or it has been altered. " +
        "See docs/secrets.md, Rotating the key.",
    );
    this.name = "UndecryptableSecretError";
  }
}

/** A new key, base64, ready to paste after `ENCRYPTION_KEY=`. */
export function generateEncryptionKey(): string {
  return randomBytes(keyBytes).toString("base64");
}

/**
 * Check a key's shape once, at the edge.
 *
 * The message says the length that was found and never the value, so a key
 * pasted into the wrong variable does not reach a terminal transcript or a
 * crash reporter.
 */
export function readEncryptionKey(value: string): EncryptionKey {
  const trimmed = value.trim();

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new InvalidEncryptionKeyError("is not base64");
  }

  const bytes = Buffer.from(trimmed, "base64");

  if (bytes.byteLength !== keyBytes) {
    throw new InvalidEncryptionKeyError(
      `is ${bytes.byteLength} bytes; AES-256 needs exactly ${keyBytes}`,
    );
  }

  return { bytes, checked: true };
}

/**
 * The key this process was started with.
 *
 * Blank means unset, for the reason `config/env.ts` gives: `.env.example` is
 * committed with blank values and `pnpm dev` copies it, so a present-and-empty
 * variable has to read the same as an absent one.
 */
export function requireEncryptionKey(
  environment: Record<string, string | undefined> = process.env,
): EncryptionKey {
  const value = environment.ENCRYPTION_KEY?.trim();

  if (!value) {
    throw new MissingEncryptionKeyError("ENCRYPTION_KEY is not set.");
  }

  return readEncryptionKey(value);
}

/** The key if one is set, or undefined. The shape is still checked. */
export function optionalEncryptionKey(
  environment: Record<string, string | undefined> = process.env,
): EncryptionKey | undefined {
  return environment.ENCRYPTION_KEY?.trim() ? requireEncryptionKey(environment) : undefined;
}

/**
 * Encrypt one value for one record.
 *
 * `record` names what holds the value — "reddit:apiKey" — and is authenticated
 * rather than encrypted: it is not a secret, and binding it is what stops one
 * record's ciphertext being used as another's.
 */
export function encryptSecret(key: EncryptionKey, plaintext: string, record: string): string {
  const nonce = randomBytes(nonceBytes);
  const cipher = createCipheriv("aes-256-gcm", key.bytes, nonce, { authTagLength: tagBytes });

  cipher.setAAD(Buffer.from(record, "utf8"));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [
    version,
    nonce.toString("base64"),
    ciphertext.toString("base64"),
    cipher.getAuthTag().toString("base64"),
  ].join(".");
}

/**
 * Decrypt one value, or throw.
 *
 * There is no "returns undefined" path on purpose. A credential that silently
 * became empty is four failed provider calls and a retry queue; a credential
 * that throws is one line in a log naming the record and a person who can act.
 */
export function decryptSecret(key: EncryptionKey, stored: string, record: string): string {
  const parts = stored.split(".");

  if (parts.length !== 4 || parts[0] !== version) {
    throw new UndecryptableSecretError(record, "the stored value is not in a format we recognise");
  }

  const [, encodedNonce, encodedCiphertext, encodedTag] = parts as [string, string, string, string];
  const nonce = Buffer.from(encodedNonce, "base64");
  const tag = Buffer.from(encodedTag, "base64");

  if (nonce.byteLength !== nonceBytes || tag.byteLength !== tagBytes) {
    throw new UndecryptableSecretError(
      record,
      "the nonce or the authentication tag is the wrong size",
    );
  }

  const decipher = createDecipheriv("aes-256-gcm", key.bytes, nonce, { authTagLength: tagBytes });

  decipher.setAAD(Buffer.from(record, "utf8"));
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (cause) {
    // `final()` is where GCM reports a failed tag. The cause is deliberately
    // dropped: OpenSSL's message says nothing a person can act on, and
    // attaching it puts provider-shaped text next to a credential's name.
    void cause;
    throw new UndecryptableSecretError(record, "the authentication tag does not match");
  }
}

/**
 * How a credential is allowed to appear anywhere a person can read.
 *
 * Four trailing characters are enough to answer "is this the key I pasted?"
 * and not enough to be one. Below eight characters even that is most of the
 * secret, so nothing is shown at all.
 */
export function maskSecret(value: string): string {
  return value.length >= 8 ? `••••${value.slice(-4)}` : "••••";
}

/** Constant-time comparison, for the one caller that compares two secrets. */
export function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");

  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

/**
 * Whether a value would be accepted as a key, without throwing.
 *
 * `config/env.ts` needs a predicate rather than a constructor, so that a bad
 * key is reported beside every other environment problem in one message
 * instead of being the only one a person sees.
 */
export function encryptionKeyIsWellFormed(value: string): boolean {
  try {
    readEncryptionKey(value);
    return true;
  } catch {
    return false;
  }
}
