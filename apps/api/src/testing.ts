/**
 * The signed-in person a route test assumes. US-017.
 *
 * Every route is behind the session gate, and almost no test is *about* the
 * gate: a test of the inbox ordering should not have to hold a cookie. So
 * these tests inject a resolver and skip the cookie, while `auth.test.ts`
 * drives the real thing — a real sign-up, a real cookie, a real sign-out —
 * over every route this build registers.
 *
 * The gate itself is never replaced. What is replaced is only how a request
 * becomes a person, which is the seam `buildServer` already opens for the
 * query generator and the describer.
 */
import {
  createTestDatabase as createPipelineTestDatabase,
  type TestDatabase,
} from "@signalscout/pipeline/testing";
import type { SessionResolver, SessionUser } from "./auth.js";
import { runAppMigrations } from "./db/migrate.js";

export type { TestDatabase };

/**
 * A database per test file, with both migration streams applied — the
 * pipeline's and then this application's — so a test here sees the account
 * tables the pipeline's own harness does not know about. US-153.
 */
export function createTestDatabase(label: string): Promise<TestDatabase> {
  return createPipelineTestDatabase(label, { migrate: runAppMigrations });
}

/**
 * The id these tests own their rows under.
 *
 * The same string the rows carried before US-017, so the fixtures in files
 * that insert monitors directly keep working and keep saying the same thing.
 */
export const testOwner = "self-hosted";

export const testUser: SessionUser = {
  id: testOwner,
  email: "owner@example.test",
  name: "The owner",
};

/** A resolver that answers with `testUser` for every request. */
export const asOwner: SessionResolver = async () => testUser;

/** A resolver that answers with somebody else, for a scoping test. */
export function asUser(id: string): SessionResolver {
  return async () => ({ id, email: `${id}@example.test`, name: id });
}
