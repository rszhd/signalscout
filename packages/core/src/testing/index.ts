/**
 * Test helpers, reachable as `@intentwatch/core/testing`.
 *
 * A separate entry point rather than more names on the package's main export.
 * `createTestDatabase` creates and drops databases, and a helper that does
 * that has no business being one autocomplete away from the code that serves
 * requests.
 *
 * The API's tests need it for the same reason core's do: docs/testing.md
 * starts at real Postgres and there is no in-memory stand-in to fall back to.
 */
export { createTestDatabase, type TestDatabase } from "./database.js";
export { unreachableFetch } from "./network.js";
