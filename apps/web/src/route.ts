/**
 * Reading a value out of the hash route. US-045, US-050.
 *
 * The router lives in the hash, so a route can carry a query of its own:
 * `#/?project=<id>` is the inbox scoped to one project, and
 * `#/monitors?project=<id>` is its monitors. Three screens read the same
 * parameter, which is why this is one function rather than a third copy.
 *
 * `globalThis.location` is read on every call rather than captured, because a
 * hash change does not remount anything: a screen that captured it once would
 * keep showing the project a person had navigated away from.
 */

/** The query part of the current hash route, or an empty one. */
export function routeQuery(hash = globalThis.location?.hash ?? ""): URLSearchParams {
  return new URLSearchParams(hash.split("?")[1] ?? "");
}

/**
 * One parameter, or null.
 *
 * Null rather than an empty string, so a caller can spread it into a request
 * and have absence mean absence — `project=` would filter on a project whose
 * id is the empty string, which is a query that matches nothing and looks like
 * an empty inbox.
 */
export function routeParam(name: string, hash?: string): string | null {
  const found = routeQuery(hash).get(name);
  return found === null || found.trim() === "" ? null : found;
}

/** The path part, without its query: `#/monitors?x=1` is `#/monitors`. */
export function routePath(hash = globalThis.location?.hash ?? ""): string {
  return hash.split("?")[0] ?? "";
}
