/**
 * Every address in this application, in one table. US-076.
 *
 * The route used to live in the hash, and a Stripe return then read
 * `/billing?checkout=done#/billing` — one address saying the same thing twice,
 * because the path was the server's answer and the hash was the app's. There
 * is one now. Fastify already hands `index.html` to any path that is not an
 * API route or a file, and Vite does the same in development, so a path route
 * is a real address: it can be bookmarked, linked to, and returned to by a
 * payment provider.
 *
 * The project is a path segment rather than a query parameter. An inbox is a
 * question about one business, so the business is what the address is *of* —
 * `/projects/<id>` — and not a filter laid over a page that means something
 * without it.
 *
 * These are builders rather than strings, so the shape of an address is
 * written once. `routes` beside them is the same table as the router matches
 * it, and `App.tsx` is the only file that needs those.
 */

/** The patterns the router matches. Only `App.tsx` uses these. */
export const routes = {
  projects: "/projects",
  newProject: "/projects/new",
  editProject: "/projects/:projectId/edit",
  inbox: "/projects/:projectId",
  monitors: "/projects/:projectId/monitors",
  newMonitor: "/projects/:projectId/monitors/new",
  monitor: "/projects/:projectId/monitors/:monitorId",
  notifications: "/projects/:projectId/monitors/:monitorId/notifications",
  connections: "/connections",
  providers: "/providers",
  replyVoices: "/reply-voices",
  models: "/models",
  billing: "/billing",
} as const;

/**
 * The address of each screen.
 *
 * Every id is encoded, because a path segment carrying a slash would silently
 * become a different route.
 */
export const paths = {
  projects: routes.projects,
  newProject: routes.newProject,
  editProject: (projectId: string): string => `/projects/${encodeURIComponent(projectId)}/edit`,
  inbox: (projectId: string): string => `/projects/${encodeURIComponent(projectId)}`,
  monitors: (projectId: string): string => `${paths.inbox(projectId)}/monitors`,
  newMonitor: (projectId: string): string => `${paths.monitors(projectId)}/new`,
  monitor: (projectId: string, monitorId: string): string =>
    `${paths.monitors(projectId)}/${encodeURIComponent(monitorId)}`,
  notifications: (projectId: string, monitorId: string): string =>
    `${paths.monitors(projectId)}/${encodeURIComponent(monitorId)}/notifications`,
  connections: routes.connections,
  providers: routes.providers,
  replyVoices: routes.replyVoices,
  models: routes.models,
  billing: routes.billing,
} as const;
