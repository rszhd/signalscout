# SignalScout admin

A small Vite + React panel for the operator of a hosted instance. It is built
with shadcn/ui, separately from `apps/web`, which has its own design system.

It reads one endpoint, `GET /api/admin/registrations`, and is served by the API
at `/admin`. Because it is same-origin, it uses the session cookie the
application already set — there is no second login and no CORS.

## Who may see it

`ADMIN_EMAILS` in the environment, comma separated. An account that is signed in
but not listed gets `403`; an instance that lists nobody shows the panel to
nobody. There is no role column and no migration.

## Development

```sh
pnpm install          # from the repository root; this folder is a workspace package
pnpm --filter @signalscout/admin dev
```

Vite serves the panel on <http://localhost:5174> and proxies `/api` to the API
on port 3000. Sign in on the application first, then open the panel.

## Build

```sh
pnpm --filter @signalscout/admin build
```

The output is `admin/dist`, which the API serves at `/admin`. The panel is
marked `noindex, nofollow`.
