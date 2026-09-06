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

/**
 * The current project as a query suffix, or an empty string.
 *
 * `#/monitors${projectSuffix()}` keeps a link inside the project a person is
 * looking at. Read live rather than passed down: a link is rendered wherever
 * it is rendered, and threading the project through every component that draws
 * one is how a single missed prop becomes a link that silently leaves the
 * project.
 *
 * `App.tsx` refuses the unscoped routes outright, so this is what stops that
 * refusal being reached rather than what enforces it.
 */
export function projectSuffix(hash?: string): string {
  const project = routeParam("project", hash);
  return project === null ? "" : `?project=${project}`;
}
