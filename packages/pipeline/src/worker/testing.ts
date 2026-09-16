/**
 * Helpers the worker's test files share.
 *
 * The registry here is the fake connector under the pair "reddit" and
 * "brightdata". The fake because no test reaches Reddit; under that pair
 * because the schema only accepts a platform and a provider it knows, on
 * `posts.source`, `api_usage.provider` and `source_continuations.provider`
 * alike. A registry holding "fake via fake-provider" is one no deployment can
 * have, and a test that stored its rows would prove nothing about the poll a
 * deployment actually runs.
 */

import {
  createSourceRegistry,
  createSourceRuntime,
  type FakeSourceOptions,
  fakeSourceDefinition,
  type Logger,
  type SourceRegistry,
} from "@signalscout/engine";
import { silentLogger, unreachableFetch } from "@signalscout/engine/testing";

export { fastRetries, insertMonitor } from "../testing/monitors.js";
export { silentLogger };

export function fakeRegistry(
  options: FakeSourceOptions = {},
  logger: Logger = silentLogger,
): SourceRegistry {
  return createSourceRegistry({
    definitions: [
      fakeSourceDefinition({
        id: "reddit",
        displayName: "Reddit",
        providerId: "brightdata",
        providerName: "Bright Data",
        ...options,
      }),
    ],
    // The real network is unreachable, not merely unused.
    runtime: createSourceRuntime({ fetch: unreachableFetch, logger }),
  });
}

/**
 * Reddit under both of its providers, which is what a provider choice looks
 * like.
 *
 * One fake per provider, each with its own posts, so a test can tell which one
 * ran by what came back. US-026 needs it: every rule about choosing is a rule
 * about a platform two connectors can fetch, and one connector cannot express
 * it.
 */
export function twoProviderRegistry(
  perProvider: Readonly<Record<string, FakeSourceOptions>> = {},
  logger: Logger = silentLogger,
): SourceRegistry {
  return createSourceRegistry({
    definitions: ["brightdata", "scrapecreators"].map((providerId) =>
      fakeSourceDefinition({
        id: "reddit",
        displayName: "Reddit",
        providerId,
        providerName: providerId,
        ...perProvider[providerId],
      }),
    ),
    runtime: createSourceRuntime({ fetch: unreachableFetch, logger }),
  });
}

/**
 * Wait on something that has definitely happened, never on a number of
 * milliseconds. docs/testing.md: a wait in milliseconds is a race, and
 * widening the timeout hides a real defect inside the number a busy machine
 * produces.
 */
export async function until<T>(
  description: string,
  check: () => Promise<T | undefined> | (T | undefined),
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${description}.`);
}
