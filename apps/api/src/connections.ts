/**
 * The connections screen's routes: paste a provider key, test it, store it.
 *
 * Correctness-critical: credential encryption. docs/testing.md names the
 * failure — a key reaching a log line or an API response — and this is the
 * first file in the product that writes one. Three rules hold it together, and
 * `connections.test.ts` was written before any of them.
 *
 * **A key is tested with the provider before it is stored.** US-010 deferred
 * this and said why: a key that is present and wrong passes every check we
 * have, starts a monitor, and fails at the first poll — four retries and a
 * dead letter, at whatever hour the schedule picked. On Reddit the probe costs
 * nothing, because an empty input list cannot start a collection.
 *
 * **A refusal and an outage are different answers.** The provider saying "this
 * key is wrong" is a 200 carrying `valid: false`, because the request worked
 * and the answer is the point. The provider not answering at all is a 502.
 * Collapsing the two sends a person hunting for a typo in a key that is
 * correct.
 *
 * **Nothing here returns a stored key.** The read side is `listCredentialHints`
 * and the `hint` column, so showing which key is set decrypts nothing.
 * `credentials.test.ts` asserts that structurally over every route this build
 * registers, including these.
 */
import {
  createSourceRuntime,
  credentialRecordName,
  type Database,
  deleteSourceCredential,
  environmentVariableFor,
  type Logger,
  listCredentialHints,
  optionalEncryptionKey,
  putSourceCredential,
  readSourceCredential,
  type Source,
  type SourceCredentials,
  type SourceDefinition,
} from "@intentwatch/core";
import { z } from "zod";
import type { ApiServer } from "./server.js";

export interface ConnectionRoutesOptions {
  readonly db: Database;
  readonly sources: readonly SourceDefinition[];
  /** The environment half of where a key lives. Injected so a test has none. */
  readonly environment?: Record<string, string | undefined>;
  /**
   * Where `ENCRYPTION_KEY` is read from.
   *
   * Separate from `environment` above, which is the provider keys. A test
   * describes an instance that can store and one that cannot without also
   * having to describe its Reddit key.
   */
  readonly encryption?: Record<string, string | undefined>;
  readonly logger: Logger;
}

/** The sentence an instance with no key is shown, in both places it is shown. */
const noEncryptionKey =
  "This instance cannot store a key yet. Set ENCRYPTION_KEY to the base64 of 32 " +
  "random bytes — `openssl rand -base64 32` — and restart. Until then, put the " +
  "provider key in the environment variable named beside each field.";

interface FieldView {
  name: string;
  label: string;
  environmentVariable: string;
  /** `••••1234`, or null when nothing is stored. Never the value. */
  storedHint: string | null;
  fromEnvironment: boolean;
  configured: boolean;
}

const fieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  environmentVariable: z.string(),
  storedHint: z.string().nullable(),
  fromEnvironment: z.boolean(),
  configured: z.boolean(),
});

const sourceSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  ready: z.boolean(),
  credentials: z.array(fieldSchema),
});

/** What a failed request answers with, the shape every screen already reads. */
const problemSchema = z.object({ message: z.string() });

const credentialsBody = z.object({
  /**
   * The fields a person filled in. A field left out keeps whatever is already
   * configured, so a source with two keys can have one of them changed.
   */
  credentials: z.record(z.string(), z.string()).default({}),
});

export async function registerConnectionRoutes(
  app: ApiServer,
  options: ConnectionRoutesOptions,
): Promise<void> {
  const { db, sources, logger } = options;
  const environment = options.environment ?? process.env;
  const encryption = options.encryption ?? process.env;

  function find(id: string): SourceDefinition | undefined {
    return sources.find((source) => source.id === id);
  }

  /** The store's answer, as a map from field name to its mask. */
  async function hintsFor(sourceId: string): Promise<Map<string, string>> {
    const hints = await listCredentialHints(db);
    return new Map(
      hints.filter((hint) => hint.source === sourceId).map((hint) => [hint.field, hint.hint]),
    );
  }

  async function view(definition: SourceDefinition) {
    const hints = await hintsFor(definition.id);

    const credentials: FieldView[] = definition.credentialFields.map((field) => {
      const storedHint = hints.get(field.name) ?? null;
      const fromEnvironment = Boolean(
        environment[environmentVariableFor(definition.id, field.name)],
      );

      return {
        name: field.name,
        label: field.label,
        environmentVariable: environmentVariableFor(definition.id, field.name),
        storedHint,
        fromEnvironment,
        configured: storedHint !== null || fromEnvironment,
      };
    });

    return {
      id: definition.id,
      displayName: definition.displayName,
      ready: credentials.every((field) => field.configured),
      credentials,
    };
  }

  /**
   * What the probe is given: what was typed, then what is stored, then the
   * environment.
   *
   * The order is `worker/credentials.ts`'s order with the typed value in
   * front, so a test answers about the credentials a poll would actually use.
   * A source whose key is only in the environment can therefore be tested
   * without anybody retyping it.
   */
  async function credentialsToTest(
    definition: SourceDefinition,
    typed: Record<string, string>,
  ): Promise<{ credentials: SourceCredentials } | { missing: string }> {
    const key = optionalEncryptionKey(encryption);
    const credentials: Record<string, string> = {};

    for (const field of definition.credentialFields) {
      const stored = key
        ? await readSourceCredential(db, key, definition.id as Source, field.name)
        : undefined;
      const value =
        typed[field.name]?.trim() ||
        stored ||
        environment[environmentVariableFor(definition.id, field.name)];

      if (!value) return { missing: field.label };
      credentials[field.name] = value;
    }

    return { credentials };
  }

  /** Names a person typed that the source does not have. */
  function unknownFields(
    definition: SourceDefinition,
    typed: Record<string, string>,
  ): readonly string[] {
    const known = new Set(definition.credentialFields.map((field) => field.name));
    return Object.keys(typed).filter((name) => !known.has(name));
  }

  /**
   * Ask the provider, and keep the two failures apart.
   *
   * A thrown error is the network. `validateCredentials` throws only for what
   * it could not interpret as the provider's own answer, so anything reaching
   * here means the question was never answered.
   */
  async function probe(
    definition: SourceDefinition,
    credentials: SourceCredentials,
  ): Promise<{ valid: boolean; reason: string | null } | { unreachable: string }> {
    const source = definition.create(createSourceRuntime({ logger }));

    try {
      const check = await source.validateCredentials(credentials);
      return { valid: check.valid, reason: check.valid ? null : check.reason };
    } catch (cause) {
      // The cause is logged, never the credentials that produced it.
      logger.warn(
        { source: definition.id, cause: cause instanceof Error ? cause.message : "unknown" },
        "the provider could not be reached for a credential check",
      );
      return {
        unreachable:
          `${definition.displayName} could not be reached, so the key was not tested. ` +
          "Try again in a moment.",
      };
    }
  }

  app.route({
    method: "GET",
    url: "/api/connections",
    schema: {
      response: {
        200: z.object({
          /** False when no `ENCRYPTION_KEY` is set. The screen offers no save. */
          canStore: z.boolean(),
          storeBlocker: z.string().nullable(),
          sources: z.array(sourceSchema),
        }),
      },
    },
    handler: async () => {
      const canStore = Boolean(optionalEncryptionKey(encryption));

      return {
        canStore,
        storeBlocker: canStore ? null : noEncryptionKey,
        sources: await Promise.all(sources.map(view)),
      };
    },
  });

  app.route({
    method: "POST",
    url: "/api/connections/:source/test",
    schema: {
      params: z.object({ source: z.string() }),
      body: credentialsBody,
      response: {
        200: z.object({ valid: z.boolean(), reason: z.string().nullable() }),
        400: problemSchema,
        404: problemSchema,
        // The provider did not answer. Not the same as refusing the key, and
        // the screen offers "try again" rather than "check what you typed".
        502: problemSchema,
      },
    },
    handler: async (request, reply) => {
      const definition = find(request.params.source);
      if (!definition) {
        return reply.code(404).send({ message: unknownSource(request.params.source, sources) });
      }

      const unknown = unknownFields(definition, request.body.credentials);
      if (unknown.length > 0) {
        return reply.code(400).send({ message: unknownFieldMessage(definition, unknown) });
      }

      const candidate = await credentialsToTest(definition, request.body.credentials);
      if ("missing" in candidate) {
        return reply
          .code(400)
          .send({ message: `There is no ${candidate.missing} to test. Paste one first.` });
      }

      const answer = await probe(definition, candidate.credentials);
      if ("unreachable" in answer) return reply.code(502).send({ message: answer.unreachable });

      return answer;
    },
  });

  app.route({
    method: "PUT",
    url: "/api/connections/:source",
    schema: {
      params: z.object({ source: z.string() }),
      body: credentialsBody,
      response: {
        200: sourceSchema,
        400: problemSchema,
        404: problemSchema,
        // No `ENCRYPTION_KEY`: nothing is wrong with the key, and nothing can
        // hold it. 409 rather than 500, because the instance is misconfigured
        // and not broken.
        409: problemSchema,
        502: problemSchema,
      },
    },
    handler: async (request, reply) => {
      const definition = find(request.params.source);
      if (!definition) {
        return reply.code(404).send({ message: unknownSource(request.params.source, sources) });
      }

      const typed = request.body.credentials;

      const unknown = unknownFields(definition, typed);
      if (unknown.length > 0) {
        return reply.code(400).send({ message: unknownFieldMessage(definition, unknown) });
      }

      // Checked before the probe, so a person is not made to wait for a
      // network call that ends in a refusal to write whatever it returns.
      const key = optionalEncryptionKey(encryption);
      if (!key) return reply.code(409).send({ message: noEncryptionKey });

      const written: [string, string][] = Object.entries(typed).filter(([, value]) => value.trim());
      if (written.length === 0) {
        return reply.code(400).send({ message: "Paste a key before saving." });
      }

      const candidate = await credentialsToTest(definition, typed);
      if ("missing" in candidate) {
        return reply
          .code(400)
          .send({ message: `${definition.displayName} also needs a ${candidate.missing}.` });
      }

      const answer = await probe(definition, candidate.credentials);
      if ("unreachable" in answer) return reply.code(502).send({ message: answer.unreachable });
      if (!answer.valid) {
        return reply.code(400).send({
          message:
            answer.reason ??
            `${definition.displayName} did not accept that key, so it was not saved.`,
        });
      }

      for (const [field, value] of written) {
        await putSourceCredential(db, key, {
          source: definition.id as Source,
          field,
          value: value.trim(),
        });
      }

      logger.info(
        // The record's name, never the value. `secrets/leak.test.ts` asserts
        // that a credential logged by mistake is redacted; this line has none
        // to redact.
        { records: written.map(([field]) => credentialRecordName(definition.id, field)) },
        "stored a provider credential",
      );

      return view(definition);
    },
  });

  app.route({
    method: "DELETE",
    url: "/api/connections/:source/:field",
    schema: {
      params: z.object({ source: z.string(), field: z.string() }),
      response: { 200: sourceSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const definition = find(request.params.source);
      if (!definition) {
        return reply.code(404).send({ message: unknownSource(request.params.source, sources) });
      }

      const hints = await hintsFor(definition.id);
      if (!hints.has(request.params.field)) {
        return reply.code(404).send({
          message:
            `Nothing is stored for ${credentialRecordName(definition.id, request.params.field)}. ` +
            "A key that came from the environment is removed by editing it there.",
        });
      }

      await deleteSourceCredential(db, definition.id as Source, request.params.field);

      return view(definition);
    },
  });
}

function unknownSource(id: string, sources: readonly SourceDefinition[]): string {
  return (
    `There is no source "${id}" in this build. ` +
    `It has: ${sources.map((source) => source.id).join(", ") || "(none)"}.`
  );
}

function unknownFieldMessage(definition: SourceDefinition, unknown: readonly string[]): string {
  return (
    `${definition.displayName} has no credential called ${unknown.join(", ")}. ` +
    `It needs: ${definition.credentialFields.map((field) => field.name).join(", ")}.`
  );
}
