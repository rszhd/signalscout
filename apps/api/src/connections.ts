/**
 * The connections screen's routes: paste a provider key, test it, store it.
 *
 * Keyed by provider, and US-024 made it so. One Bright Data key serves Reddit,
 * X and LinkedIn, so a screen keyed by platform would ask for the same key
 * once per platform and rotate it once per platform. A card here is an account
 * a person holds, and it names the platforms that key unlocks.
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
  type ConnectorDefinition,
  clearProviderChoice,
  createSourceRuntime,
  credentialSlotName,
  type Database,
  decideProvider,
  deleteSourceCredential,
  environmentVariableFor,
  groupByPlatform,
  type Logger,
  listCredentialHints,
  optionalEncryptionKey,
  type PlatformConnectors,
  type Provider,
  type ProviderChoices,
  putSourceCredential,
  readProviderChoices,
  readSourceCredential,
  type Source,
  type SourceCredentials,
  setProviderChoice,
} from "@intentwatch/core";
import { z } from "zod";
import { sessionUserId } from "./auth.js";
import type { ApiServer } from "./server.js";

export interface ConnectionRoutesOptions {
  readonly db: Database;
  readonly sources: readonly ConnectorDefinition[];
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

const providerSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  /** The platforms this one key unlocks. "Reddit", not "reddit". */
  platforms: z.array(z.string()),
  ready: z.boolean(),
  credentials: z.array(fieldSchema),
});

/**
 * One platform, and who fetches it.
 *
 * The second half of this screen, and US-026 added it. A person ticks
 * platforms when they make a monitor; this is where they say, once, which
 * account pays for each one. The monitor form never asks.
 */
const platformSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  providers: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      /** True when this deployment holds the provider's key. */
      connected: z.boolean(),
    }),
  ),
  /** The recorded choice, or null when nobody has made one. */
  chosen: z.string().nullable(),
  /** Who would fetch it on the next collection, or null when nothing can. */
  effective: z.string().nullable(),
  /** True when two providers could run it and nobody has chosen. */
  needsChoice: z.boolean(),
  /** Null while the platform can be collected. Otherwise the sentence why not. */
  blocker: z.string().nullable(),
});

const connectionsSchema = z.object({
  /** False when no `ENCRYPTION_KEY` is set. The screen offers no save. */
  canStore: z.boolean(),
  storeBlocker: z.string().nullable(),
  providers: z.array(providerSchema),
  platforms: z.array(platformSchema),
});

/** What a failed request answers with, the shape every screen already reads. */
const problemSchema = z.object({ message: z.string() });

const credentialsBody = z.object({
  /**
   * The fields a person filled in. A field left out keeps whatever is already
   * configured, so a provider with two keys can have one of them changed.
   */
  credentials: z.record(z.string(), z.string()).default({}),
});

/**
 * The providers this build ships, each with the platforms it fetches.
 *
 * Grouped rather than listed, because a provider is what a key belongs to and
 * a connector is a pair. Bright Data fetching three platforms is one card, one
 * key and one rotation.
 */
interface ProviderEntry {
  readonly descriptor: ConnectorDefinition["provider"];
  readonly platformNames: readonly string[];
  /**
   * The connector the probe runs through.
   *
   * Any of the provider's connectors would answer the same question — the key
   * is the account's, not the platform's — so the first registered one is
   * taken, and nothing here depends on which.
   */
  readonly probeWith: ConnectorDefinition;
}

function providersOf(sources: readonly ConnectorDefinition[]): ProviderEntry[] {
  const entries = new Map<string, { entry: ProviderEntry; platforms: string[] }>();

  for (const source of sources) {
    const found = entries.get(source.provider.id);

    if (found) {
      found.platforms.push(source.platform.displayName);
      continue;
    }

    const platforms: string[] = [source.platform.displayName];
    entries.set(source.provider.id, {
      platforms,
      entry: { descriptor: source.provider, platformNames: platforms, probeWith: source },
    });
  }

  return [...entries.values()].map(({ entry }) => entry);
}

export async function registerConnectionRoutes(
  app: ApiServer,
  options: ConnectionRoutesOptions,
): Promise<void> {
  const { db, sources, logger } = options;
  const environment = options.environment ?? process.env;
  const encryption = options.encryption ?? process.env;
  const providers = providersOf(sources);
  const platformEntries = groupByPlatform(sources);

  function find(id: string): ProviderEntry | undefined {
    return providers.find((provider) => provider.descriptor.id === id);
  }

  /** The store's answer for one person, as a map from field name to its mask. */
  async function hintsFor(userId: string, providerId: string): Promise<Map<string, string>> {
    const hints = await listCredentialHints(db, userId);
    return new Map(
      hints.filter((hint) => hint.provider === providerId).map((hint) => [hint.field, hint.hint]),
    );
  }

  async function view(userId: string, provider: ProviderEntry) {
    const { descriptor } = provider;
    const hints = await hintsFor(userId, descriptor.id);

    const credentials: FieldView[] = descriptor.credentialFields.map((field) => {
      const storedHint = hints.get(field.name) ?? null;
      const variable = environmentVariableFor(descriptor.id, field.name);
      const fromEnvironment = Boolean(environment[variable]);

      return {
        name: field.name,
        label: field.label,
        environmentVariable: variable,
        storedHint,
        fromEnvironment,
        configured: storedHint !== null || fromEnvironment,
      };
    });

    return {
      id: descriptor.id,
      displayName: descriptor.displayName,
      platforms: [...provider.platformNames],
      ready: credentials.every((field) => field.configured),
      credentials,
    };
  }

  /**
   * Which providers this deployment holds a whole key for.
   *
   * One read of the hints for every provider, rather than one per card. The
   * hints never decrypt, so this costs no encryption key.
   */
  async function connectedProviders(userId: string): Promise<Set<string>> {
    const hints = await listCredentialHints(db, userId);
    const stored = new Set(hints.map((hint) => `${hint.provider}:${hint.field}`));
    const connected = new Set<string>();

    for (const { descriptor } of providers) {
      const whole = descriptor.credentialFields.every(
        (field) =>
          stored.has(`${descriptor.id}:${field.name}`) ||
          Boolean(environment[environmentVariableFor(descriptor.id, field.name)]),
      );

      if (whole) connected.add(descriptor.id);
    }

    return connected;
  }

  /**
   * One platform, and who fetches it.
   *
   * The decision comes from `decideProvider`, the same function the poll goes
   * through. A screen with its own copy of the rule is a screen that says a
   * platform is ready while every poll of it is refused.
   */
  function platformView(
    { platform, providers: fetchers }: PlatformConnectors,
    choices: ProviderChoices,
    connected: ReadonlySet<string>,
  ) {
    const registered = fetchers.map((provider) => provider.id);
    const usable = registered.filter((id) => connected.has(id));
    const decision = decideProvider(platform.id, registered, usable, choices);
    const name = (id: string) => fetchers.find((provider) => provider.id === id)?.displayName ?? id;

    return {
      id: platform.id,
      displayName: platform.displayName,
      providers: fetchers.map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        connected: connected.has(provider.id),
      })),
      chosen: choices[platform.id] ?? null,
      effective: decision.status === "chosen" ? decision.providerId : null,
      needsChoice: decision.status === "undecided",
      blocker:
        decision.status === "chosen"
          ? null
          : decision.status === "undecided"
            ? `${decision.providers.map(name).join(" and ")} can both fetch ` +
              `${platform.displayName}. Choose one: a poll will not pick for you, ` +
              "because picking would spend money at a provider you did not choose."
            : decision.chosen
              ? `${platform.displayName} is set to fetch through ${name(decision.chosen)}, ` +
                "which has no key here. Connect it, or choose another provider."
              : `No provider is connected for ${platform.displayName}, ` +
                `so nothing can collect it. Connect ${registered.map(name).join(" or ")}.`,
    };
  }

  /** The whole screen: the provider cards, and the platform rows under them. */
  async function connectionsView(userId: string) {
    const canStore = Boolean(optionalEncryptionKey(encryption));

    return {
      canStore,
      storeBlocker: canStore ? null : noEncryptionKey,
      providers: await Promise.all(providers.map((provider) => view(userId, provider))),
      platforms: await platformViews(userId),
    };
  }

  /** Every platform, with the choices and the keys read once for all of them. */
  async function platformViews(userId: string) {
    const [choices, connected] = await Promise.all([
      readProviderChoices(db),
      connectedProviders(userId),
    ]);

    return platformEntries.map((platform) => platformView(platform, choices, connected));
  }

  /**
   * What the probe is given: what was typed, then what is stored, then the
   * environment.
   *
   * The order is `worker/credentials.ts`'s order with the typed value in
   * front, so a test answers about the credentials a poll would actually use.
   * A provider whose key is only in the environment can therefore be tested
   * without anybody retyping it.
   */
  async function credentialsToTest(
    userId: string,
    { descriptor }: ProviderEntry,
    typed: Record<string, string>,
  ): Promise<{ credentials: SourceCredentials } | { missing: string }> {
    const key = optionalEncryptionKey(encryption);
    const credentials: Record<string, string> = {};

    for (const field of descriptor.credentialFields) {
      const stored = key
        ? await readSourceCredential(db, key, userId, descriptor.id as Provider, field.name)
        : undefined;
      const value =
        typed[field.name]?.trim() ||
        stored ||
        environment[environmentVariableFor(descriptor.id, field.name)];

      if (!value) return { missing: field.label };
      credentials[field.name] = value;
    }

    return { credentials };
  }

  /** Names a person typed that the provider does not have. */
  function unknownFields(
    { descriptor }: ProviderEntry,
    typed: Record<string, string>,
  ): readonly string[] {
    const known = new Set(descriptor.credentialFields.map((field) => field.name));
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
    provider: ProviderEntry,
    credentials: SourceCredentials,
  ): Promise<{ valid: boolean; reason: string | null } | { unreachable: string }> {
    const source = provider.probeWith.create(createSourceRuntime({ logger }));

    try {
      const check = await source.validateCredentials(credentials);
      return { valid: check.valid, reason: check.valid ? null : check.reason };
    } catch (cause) {
      // The cause is logged, never the credentials that produced it.
      logger.warn(
        {
          provider: provider.descriptor.id,
          cause: cause instanceof Error ? cause.message : "unknown",
        },
        "the provider could not be reached for a credential check",
      );
      return {
        unreachable:
          `${provider.descriptor.displayName} could not be reached, so the key was not tested. ` +
          "Try again in a moment.",
      };
    }
  }

  app.route({
    method: "GET",
    url: "/api/connections",
    schema: {
      response: { 200: connectionsSchema },
    },
    handler: async (request) => connectionsView(sessionUserId(request)),
  });

  /**
   * Record which provider fetches a platform.
   *
   * `PUT`, because one platform has one provider and sending it twice must
   * leave one row. It answers with the whole screen rather than the one
   * platform: a choice changes what the other platforms of the same provider
   * are allowed to do, and a screen that patched one row would show a stale
   * answer beside a fresh one.
   *
   * It does not touch a collection in flight. `source_continuations` carries
   * the provider that started one, so this takes effect on the next
   * collection and never resumes one provider's snapshot through the other.
   */
  app.route({
    method: "PUT",
    url: "/api/platforms/:platform/provider",
    schema: {
      params: z.object({ platform: z.string() }),
      body: z.object({ provider: z.string() }),
      response: { 200: connectionsSchema, 400: problemSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const platform = platformEntries.find(
        (entry) => entry.platform.id === request.params.platform,
      );

      if (!platform) {
        return reply.code(404).send({
          message:
            `There is no platform "${request.params.platform}" in this build. ` +
            `It has: ${platformEntries.map((entry) => entry.platform.id).join(", ") || "(none)"}.`,
        });
      }

      // A pair no connector has is refused here rather than at the next poll.
      // The database cannot check it — the pairs live in the registry, not in
      // a constraint — so this is the check, and it names the alternatives.
      if (!platform.providers.some((provider) => provider.id === request.body.provider)) {
        return reply.code(400).send({
          message:
            `Nothing fetches ${platform.platform.displayName} through "${request.body.provider}". ` +
            `It is fetched by: ${platform.providers.map((provider) => provider.id).join(", ")}.`,
        });
      }

      await setProviderChoice(
        db,
        platform.platform.id as Source,
        request.body.provider as Provider,
      );

      logger.info(
        { platform: platform.platform.id, provider: request.body.provider },
        "recorded which provider fetches a platform",
      );

      return connectionsView(sessionUserId(request));
    },
  });

  /**
   * Forget the choice for a platform.
   *
   * The platform then answers by itself again whenever one provider can run,
   * and asks again when two can. It is the undo for a choice, and it is not
   * the same as disconnecting a provider: the keys stay.
   */
  app.route({
    method: "DELETE",
    url: "/api/platforms/:platform/provider",
    schema: {
      params: z.object({ platform: z.string() }),
      response: { 200: connectionsSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const platform = platformEntries.find(
        (entry) => entry.platform.id === request.params.platform,
      );

      if (!platform) {
        return reply.code(404).send({
          message:
            `There is no platform "${request.params.platform}" in this build. ` +
            `It has: ${platformEntries.map((entry) => entry.platform.id).join(", ") || "(none)"}.`,
        });
      }

      await clearProviderChoice(db, platform.platform.id as Source);

      return connectionsView(sessionUserId(request));
    },
  });

  app.route({
    method: "POST",
    url: "/api/connections/:provider/test",
    schema: {
      params: z.object({ provider: z.string() }),
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
      const provider = find(request.params.provider);
      if (!provider) {
        return reply
          .code(404)
          .send({ message: unknownProvider(request.params.provider, providers) });
      }

      const unknown = unknownFields(provider, request.body.credentials);
      if (unknown.length > 0) {
        return reply.code(400).send({ message: unknownFieldMessage(provider, unknown) });
      }

      const candidate = await credentialsToTest(
        sessionUserId(request),
        provider,
        request.body.credentials,
      );
      if ("missing" in candidate) {
        return reply
          .code(400)
          .send({ message: `There is no ${candidate.missing} to test. Paste one first.` });
      }

      const answer = await probe(provider, candidate.credentials);
      if ("unreachable" in answer) return reply.code(502).send({ message: answer.unreachable });

      return answer;
    },
  });

  app.route({
    method: "PUT",
    url: "/api/connections/:provider",
    schema: {
      params: z.object({ provider: z.string() }),
      body: credentialsBody,
      response: {
        200: providerSchema,
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
      const provider = find(request.params.provider);
      if (!provider) {
        return reply
          .code(404)
          .send({ message: unknownProvider(request.params.provider, providers) });
      }

      const typed = request.body.credentials;

      const unknown = unknownFields(provider, typed);
      if (unknown.length > 0) {
        return reply.code(400).send({ message: unknownFieldMessage(provider, unknown) });
      }

      // Checked before the probe, so a person is not made to wait for a
      // network call that ends in a refusal to write whatever it returns.
      const key = optionalEncryptionKey(encryption);
      if (!key) return reply.code(409).send({ message: noEncryptionKey });

      const written: [string, string][] = Object.entries(typed).filter(([, value]) => value.trim());
      if (written.length === 0) {
        return reply.code(400).send({ message: "Paste a key before saving." });
      }

      const candidate = await credentialsToTest(sessionUserId(request), provider, typed);
      if ("missing" in candidate) {
        return reply.code(400).send({
          message: `${provider.descriptor.displayName} also needs a ${candidate.missing}.`,
        });
      }

      const answer = await probe(provider, candidate.credentials);
      if ("unreachable" in answer) return reply.code(502).send({ message: answer.unreachable });
      if (!answer.valid) {
        return reply.code(400).send({
          message:
            answer.reason ??
            `${provider.descriptor.displayName} did not accept that key, so it was not saved.`,
        });
      }

      for (const [field, value] of written) {
        await putSourceCredential(db, key, {
          userId: sessionUserId(request),
          provider: provider.descriptor.id as Provider,
          field,
          value: value.trim(),
        });
      }

      logger.info(
        // The record's name, never the value. `secrets/leak.test.ts` asserts
        // that a credential logged by mistake is redacted; this line has none
        // to redact.
        {
          records: written.map(([field]) => credentialSlotName(provider.descriptor.id, field)),
        },
        "stored a provider credential",
      );

      return view(sessionUserId(request), provider);
    },
  });

  app.route({
    method: "DELETE",
    url: "/api/connections/:provider/:field",
    schema: {
      params: z.object({ provider: z.string(), field: z.string() }),
      response: { 200: providerSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const provider = find(request.params.provider);
      if (!provider) {
        return reply
          .code(404)
          .send({ message: unknownProvider(request.params.provider, providers) });
      }

      const hints = await hintsFor(sessionUserId(request), provider.descriptor.id);
      if (!hints.has(request.params.field)) {
        return reply.code(404).send({
          message:
            `Nothing is stored for ${credentialSlotName(provider.descriptor.id, request.params.field)}. ` +
            "A key that came from the environment is removed by editing it there.",
        });
      }

      await deleteSourceCredential(
        db,
        sessionUserId(request),
        provider.descriptor.id as Provider,
        request.params.field,
      );

      return view(sessionUserId(request), provider);
    },
  });
}

function unknownProvider(id: string, providers: readonly ProviderEntry[]): string {
  return (
    `There is no provider "${id}" in this build. ` +
    `It has: ${providers.map((provider) => provider.descriptor.id).join(", ") || "(none)"}.`
  );
}

function unknownFieldMessage({ descriptor }: ProviderEntry, unknown: readonly string[]): string {
  return (
    `${descriptor.displayName} has no credential called ${unknown.join(", ")}. ` +
    `It needs: ${descriptor.credentialFields.map((field) => field.name).join(", ")}.`
  );
}
