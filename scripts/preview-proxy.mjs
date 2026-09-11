/**
 * The password in front of the preview tunnel, and the split behind it.
 *
 * The tunnel points here, so nothing reaches the app without the password.
 * That matters more than it looks: the app answers four paths to a stranger —
 * the UI files, `/api/health`, `/api/auth-status` and `/api/auth/*` — and on a
 * public address those are public. US-106 put the same lock in front of
 * staging for the same reason.
 *
 * Behind the password there are two servers:
 *
 *   /api/...   the preview API, whose AUTH_URL is the tunnel address
 *   anything   Vite, including the HMR websocket
 *
 * Vite's own `/api` proxy is deliberately unused. It targets the port
 * `pnpm dev` runs its API on, and that one's AUTH_URL is `localhost:5173`, so
 * a login posted from the tunnel's origin is refused.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer, request as forward } from "node:http";
import { connect } from "node:net";

/**
 * Whether a request carries the site password.
 *
 * Every byte is compared every time. Returning early on a length difference
 * tells a caller how long the password is, and the comparison is cheap.
 */
export function authorised(header, expected) {
  if (typeof header !== "string" || !header.startsWith("Basic ")) return false;

  const got = Buffer.from(header.slice(6), "base64");
  const want = Buffer.from(expected);

  if (got.length !== want.length) return false;

  return timingSafeEqual(got, want);
}

/** Which server answers a path. The API owns `/api/`; Vite owns the rest. */
export function routeFor(url) {
  return (url ?? "").startsWith("/api/") ? "api" : "vite";
}

/**
 * The headers to send upstream.
 *
 * Two rewrites, and each exists for a failure seen on a live tunnel:
 *
 * `Host` and `Origin` become localhost for anything bound for Vite, because
 * Vite refuses a host that `server.allowedHosts` does not list. A quick
 * tunnel's name is random and changes every run, so it can never be listed.
 * Rewriting here keeps the preview out of `apps/web/vite.config.ts`.
 *
 * `x-forwarded-proto` says https, because from the browser it is, whatever
 * the plain HTTP hop inside this machine looks like.
 */
export function headersFor(headers, { target, vitePort }) {
  const copy = { ...headers };

  delete copy.authorization;
  copy["x-forwarded-proto"] = "https";

  if (target === "vite") {
    copy.host = `localhost:${vitePort}`;
    if (copy.origin) copy.origin = `http://localhost:${vitePort}`;
  }

  return copy;
}

function refuse(res) {
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="SignalScout preview", charset="UTF-8"',
    "content-type": "text/plain",
  });
  res.end("Password required.\n");
}

/** Start the proxy. Resolves with a `stop` function once it is listening. */
export function startProxy({ port, apiPort, vitePort, user, password }) {
  const expected = `${user}:${password}`;

  const server = createServer((req, res) => {
    if (!authorised(req.headers.authorization, expected)) return refuse(res);

    const target = routeFor(req.url);
    const upstream = forward(
      {
        host: "127.0.0.1",
        port: target === "api" ? apiPort : vitePort,
        method: req.method,
        path: req.url,
        headers: headersFor(req.headers, { target, vitePort }),
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );

    upstream.on("error", (error) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(
        `${target === "api" ? "The preview API" : "Vite"} is not answering: ${error.message}\n`,
      );
    });

    req.pipe(upstream);
  });

  /**
   * The HMR websocket.
   *
   * Without this the page loads and then never updates, which is the failure
   * that looks like nothing at all: no error, no console line, just a screen
   * that quietly stops matching the code.
   */
  server.on("upgrade", (req, socket, head) => {
    if (!authorised(req.headers.authorization, expected)) {
      socket.end(
        'HTTP/1.1 401 Unauthorized\r\nwww-authenticate: Basic realm="SignalScout preview"\r\n\r\n',
      );
      return;
    }

    const headers = headersFor(req.headers, { target: "vite", vitePort });
    const lines = Object.entries(headers)
      .flatMap(([name, value]) =>
        Array.isArray(value) ? value.map((one) => [name, one]) : [[name, value]],
      )
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n");

    const upstream = connect(vitePort, "127.0.0.1", () => {
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });

    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  return new Promise((resolve, reject) => {
    // Rejected, not thrown. An unhandled 'error' here kills the script where
    // it stands, and the tunnel it already started is detached and survives.
    server.once("error", reject);

    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(() => new Promise((done) => server.close(done)));
    });
  });
}
