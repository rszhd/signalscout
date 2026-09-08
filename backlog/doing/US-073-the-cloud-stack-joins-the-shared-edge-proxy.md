---
id: US-073
title: The cloud stack joins the shared edge proxy
type: feature
priority: p1
created: 2026-09-08T17:03+08:00
parent:
area: deployment
resolution:
---

## Context

This repository ships no reverse proxy. `docker-compose.yml` runs Postgres, the
migrations and the app, and publishes the app's port straight to the host.
[docs/accounts.md](../../docs/accounts.md) says to put a TLS terminator in front
of it and names Caddy, nginx and Traefik as equal options, but ships none of
them. So every deployment invents its own edge, and the hosted version has no
edge at all.

**The decision is made by the box rather than by preference.** The cloud version
runs on the same server as another project, and that project already runs a
shared Traefik: its own compose project, an external network, and one ACME
volume for every hostname on the machine. Traefik discovers backends through the
Docker socket with `exposedbydefault=false`, so a stack is invisible until it
carries `traefik.enable=true`. SignalScout's cloud stack therefore needs no
proxy of its own. It joins that network and carries router labels.

**The two databases stay apart.** The neighbouring project runs its own Postgres
in its own compose project, and SignalScout keeps its own — one database per
product, one volume per product, one `pg_dump` per product. This product needs
`pgvector` and the neighbour does not, so the images differ anyway. Only the
edge network is shared; nothing else on the box is.

**Traefik is not the easier choice for a self-hoster, and this ticket does not
claim it is.** Traefik earns its labels by discovering many backends. A person
self-hosting SignalScout has one backend and one hostname, and Caddy does that
in fewer lines. The overlay is therefore optional and off by default: an
instance that already sits behind nginx or Caddy runs exactly what it runs
today. What the overlay buys is that the hosted deployment and the documented
self-hosted one are the same mechanism, so one path is exercised rather than
two.

**`ports` is the part that must be removed rather than firewalled.** Compose
merges list fields by appending, so an overlay that omits `ports` keeps the base
file's mapping and the app stays reachable on the host address, beside the
proxy. `!override []` is what actually drops it.

## Acceptance

- [x] `docker-compose.proxy.yml` runs Traefik as its own compose project, with
      `exposedbydefault=false`, an HTTP-to-HTTPS redirect, the TLS-ALPN ACME
      challenge and a named volume for `acme.json`
- [x] The proxy project's lifecycle is independent: `down` on the app stack
      leaves the proxy and its certificates running
- [x] `docker-compose.prod.yml` drops the app's published port with
      `ports: !override []`, and the app is reachable only through the proxy
- [x] The app carries router labels written in list form, so the interpolated
      router name is not taken literally
- [x] The app joins the shared edge network and its own default network, and
      `traefik.docker.network` names which one Traefik dials
- [x] Postgres stays this product's own: its own service, its own volume, no
      shared database with any other stack on the box, and no published port
- [ ] A login over the proxy sets a `Secure` session cookie, proven in a browser
      against a real hostname rather than asserted from the header
- [x] `docs/accounts.md` and `README.md` say the overlay is optional, and say
      what a self-hoster who already has a proxy should do instead
- [x] The edge network name is a value in the compose file, not a literal, so an
      instance that names its network something else needs no edit

## Notes

- The neighbouring project's files are the precedent for every mechanism here:
  the proxy project, the `!override []` on `ports`, the list-form labels and the
  reason for each are written in its own comments. Read them before writing
  ours; three of them record a failure that produced the shape.
- Traefik must not be below v3.7. Its Docker client pinned API version 1.24
  until then and Docker Engine 29 refuses anything under 1.40 — on an older
  proxy the provider never initialises, every hostname is served the default
  certificate, and the entrypoint redirect still works, so it reads as a DNS or
  ACME fault.
- Traefik sends `X-Forwarded-Proto` on its own, which is what
  [docs/accounts.md](../../docs/accounts.md) needs for the `Secure` cookie.
  `AUTH_URL` stays empty unless the browser's address is not the one the app
  sees.
- The hosted stack runs `AUTH_SIGNUP=open`. AGENTS.md records the consequence:
  empty the provider keys out of that instance's environment first, or a
  stranger who registers polls on the machine's key and the machine's bill.
- `name: intentwatch` in `docker-compose.yml` stays. Compose prefixes volumes
  with it, and renaming it points `postgres-data` at an empty volume.
- Nothing here is proven until it runs on the server. A compose file that
  parses is evidence about YAML and none about a certificate.

## Log

- 2026-09-08T17:03+08:00 — Written after reading the neighbouring project's
  proxy and database compose files. The choice of Traefik follows from the box
  already running one, not from Traefik being simpler for one hostname. The
  databases stay separate, one per product, on the owner's decision.
- 2026-09-08T17:31+08:00 — Built both compose files, the four settings in
  `.env.example`, and the two documents. Eight boxes are ticked against
  `docker compose config` on the merged files: the app publishes no port, the
  labels interpolate to `traefik.http.routers.signalscout.*` rather than staying
  literal, Postgres publishes nothing, and both files parse.

  The healthcheck asks Node rather than curl. The runtime image is
  `node:24-alpine` and has no curl, so a copied `curl -fsS` check would have
  reported this stack unhealthy for ever and Traefik would have had one server
  and no working one.

  The ninth box is open and cannot be closed here: nobody has opened the login
  over a real hostname and seen a `Secure` cookie. A compose file that parses is
  evidence about YAML and none about a certificate. `pnpm lint` fails on
  `reply-voices.css`, which is older than this ticket and untouched by it.
- 2026-09-08T18:25+08:00 — Deployed to staging at app.signalscout-dev.space, on
  the box that already runs Traefik. The stack starts no proxy: EDGE_NETWORK is
  qassist-edge and the router labels are the whole of the integration.

  Measured from outside: HTTP answers 301 to HTTPS, the certificate is Let's
  Encrypt for the hostname, /api/health answers 200 over HTTP/2, /api/monitors
  answers 401 with no cookie, and every response carries `X-Robots-Tag:
  noindex, nofollow`. A real browser rendered the first-run form over TLS,
  which is also the screen US-017 has never seen in one.

  Three things had to be fixed before any of it could run, and none was the
  proxy: the compose default named an org that does not exist, CI published on
  main alone, and the lint failed on the landing page so no image could be
  built at all. A fourth was found by CI itself and is its own commit.

  The last box stays open. The account is the owner's to create, and signup
  closes behind the first one, so the Secure cookie is unproven until they make
  it.

  Within a minute of the hostname resolving, a scanner was asking for
  /actuator/env, /trace.axd and /@vite/env. They answer 200 because the SPA
  serves index.html for any unknown path, which is worth knowing before somebody
  reads that as a leak.
