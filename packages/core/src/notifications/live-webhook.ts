/**
 * US-096 and US-097's last question: does a signed webhook actually arrive?
 *
 *     pnpm --filter @signalscout/core live:webhook
 *
 * **It spends nothing.** No provider is called and no model is called: it
 * delivers matches this instance has already collected and classified, to a
 * receiver it starts on this machine. The only thing new is the delivery.
 *
 * **Why a real receiver rather than a test double.** Every test in the suite
 * stubs `fetch`, so what is proven there is that we build a signature — not
 * that a receiver on the other end of a socket can verify one. That is the
 * whole point of an HMAC contract, and docs/notifications.md tells a customer
 * to implement it. So this starts an HTTPS server, gives it the secret, and
 * makes it check: the timestamp, the body, the constant-time compare and the
 * delivery id, exactly as the document describes them.
 *
 * It answers three things in order:
 *
 *   1. A delivery signed with the **account's own** secret verifies at a
 *      receiver holding that secret. US-096.
 *   2. A delivery signed with a *different* secret is rejected by the same
 *      receiver, which is what makes the first result mean anything.
 *   3. With the hosted guard on, a receiver on this machine is **refused before
 *      the request** and the reason reaches `notification_settings`. US-097.
 *
 * **The certificate.** A webhook must be HTTPS, so the script makes a
 * throw-away CA and a leaf for `localhost` with `openssl`, then re-runs itself
 * with `NODE_EXTRA_CA_CERTS` pointing at the CA — because Node reads that
 * variable once, at start. Nothing is installed and the files are deleted when
 * it exits.
 */
import { execFileSync } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { desc, eq } from "drizzle-orm";
import type { NotificationEnv } from "../config/env.js";
import { createDatabase } from "../db/client.js";
import { monitors, notificationDeliveries, notificationSettings } from "../db/schema.js";
import {
  generateEncryptionKey,
  optionalEncryptionKey,
  readEncryptionKey,
} from "../secrets/cipher.js";
import { processNotifications } from "./deliver.js";
import { generateAccountWebhookSecret, webhookSecretFor } from "./secret.js";
import { notificationDefaults, saveNotificationSettings } from "./settings.js";
import { createNotificationTransport } from "./transport.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("No DATABASE_URL. Start Postgres with `pnpm db:up` and check .env.");
  process.exit(1);
}

const started = Date.now();
function say(line: string): void {
  console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s] ${line}`);
}

/** A throw-away CA and a leaf for `localhost`, in a directory we delete. */
function makeCertificates(dir: string): { ca: string; cert: string; key: string } {
  const ca = join(dir, "ca.pem");
  const caKey = join(dir, "ca.key");
  const cert = join(dir, "leaf.pem");
  const key = join(dir, "leaf.key");
  const csr = join(dir, "leaf.csr");
  const ext = join(dir, "leaf.ext");

  const openssl = (...args: string[]) => execFileSync("openssl", args, { stdio: "pipe" });

  openssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-keyout",
    caKey,
    "-out",
    ca,
    "-subj",
    "/CN=SignalScout live webhook CA",
  );
  openssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    csr,
    "-subj",
    "/CN=localhost",
  );

  execFileSync("bash", ["-c", `printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\\n' > ${ext}`]);

  openssl(
    "x509",
    "-req",
    "-in",
    csr,
    "-CA",
    ca,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-out",
    cert,
    "-days",
    "1",
    "-extfile",
    ext,
  );

  return { ca, cert, key };
}

/**
 * The receiver, written from docs/notifications.md and from nothing else.
 *
 * This is the customer's half of the contract. It verifies the way that
 * document says to: read the raw bytes before parsing, recompute the HMAC over
 * `timestamp + "." + rawBody`, compare in constant time, refuse a timestamp
 * more than five minutes from its own clock, and deduplicate the delivery id.
 */
interface Received {
  readonly id: string;
  readonly verified: boolean;
  readonly reason: string;
  readonly type: string;
  readonly matches: number;
}

function startReceiver(secret: () => string, cert: string, key: string) {
  const received: Received[] = [];
  const seen = new Set<string>();

  const server = createServer(
    { cert: readFileSync(cert), key: readFileSync(key) },
    (request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk as Buffer));
      request.on("end", () => {
        // Raw bytes, before anything parses them. A signature over a
        // re-serialised body is a signature over a different body.
        const raw = Buffer.concat(chunks).toString("utf8");
        const id = String(request.headers["x-signalscout-id"] ?? "");
        const timestamp = String(request.headers["x-signalscout-timestamp"] ?? "");
        const signature = String(request.headers["x-signalscout-signature"] ?? "");

        const expected = `v1=${createHmac("sha256", secret()).update(`${timestamp}.${raw}`).digest("hex")}`;
        const given = Buffer.from(signature);
        const want = Buffer.from(expected);

        let verified = given.length === want.length && timingSafeEqual(given, want);
        let reason = verified ? "signature matches" : "signature does not match";

        const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
        if (verified && !(skew < 300)) {
          verified = false;
          reason = `timestamp is ${Math.round(skew)}s from our clock`;
        }

        if (verified && seen.has(id)) reason = "already accepted this delivery id";
        if (verified) seen.add(id);

        const body = raw ? JSON.parse(raw) : {};
        received.push({
          id,
          verified,
          reason,
          type: body.type ?? "(none)",
          matches: body.matches?.length ?? 0,
        });

        response.writeHead(verified ? 204 : 401).end();
      });
    },
  );

  return {
    received,
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          resolve(typeof address === "object" && address ? address.port : 0);
        });
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Filled in by the re-run below, before `main` is called. */
let certificates: { ca: string; cert: string; key: string };

/**
 * The SMTP half of the environment, which this run does not use.
 *
 * `createNotificationTransport` builds no mailer without `SMTP_HOST`, so email
 * is off here by construction and only the webhook is exercised.
 */
const notificationEnv: NotificationEnv = {
  SMTP_PORT: 587,
  SMTP_SECURE: false,
};

async function main(): Promise<void> {
  const { db, close } = createDatabase(databaseUrl as string);

  // A key of this run's own when the instance has none, so the script works on
  // a machine that has never stored a credential.
  const key = optionalEncryptionKey() ?? readEncryptionKey(generateEncryptionKey());

  try {
    /**
     * A monitor that already has matches, and settings backdated to before
     * them.
     *
     * `enabled_since` excludes a backlog by design, so a run that saved
     * settings now would have nothing to deliver. Backdating is what the clock
     * would have done, and `saveNotificationSettings` already takes the moment
     * as an argument.
     */
    const [monitor] = await db
      .select({ id: monitors.id, name: monitors.name, userId: monitors.userId })
      .from(monitors)
      .orderBy(desc(monitors.createdAt))
      .limit(1);

    if (!monitor) {
      console.error("No monitor to deliver for. Run `live:notification` first.");
      process.exit(1);
    }

    const secret = await generateAccountWebhookSecret(db, key, monitor.userId);
    say(`account ${monitor.userId} — secret ••••${secret.slice(-4)}`);

    let held = secret;
    const receiver = startReceiver(() => held, certificates.cert, certificates.key);
    const port = await receiver.listen();
    const url = `https://localhost:${port}/hook`;
    say(`receiver listening on ${url}`);

    const backdated = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const resolveSecret = (userId: string) => webhookSecretFor(db, userId, key, undefined);

    /**
     * Make the same matches eligible again.
     *
     * A delivered match is assigned to its delivery and never sent twice, which
     * is the rule that stops a digest repeating itself. Three runs over one set
     * of matches therefore need the assignments cleared between them — the
     * script's own reset, and the only thing here that a real deployment never
     * does.
     */
    const reset = async () => {
      await db
        .delete(notificationDeliveries)
        .where(eq(notificationDeliveries.monitorId, monitor.id));

      await saveNotificationSettings(
        db,
        monitor.id,
        {
          ...notificationDefaults,
          emailEnabled: false,
          webhookEnabled: true,
          webhookUrl: url,
          webhookMode: "digest",
          minScore: 50,
        },
        backdated,
      );
    };

    await reset();
    const at = new Date();

    // 1. The self-hosted shape: the guard is off, so a receiver on this
    //    machine is allowed, which is the whole reason it is tied to signup.
    say("delivering with the account's own secret, guard off (self-hosted)");
    await processNotifications(db, monitor.id, createNotificationTransport(notificationEnv), at, {
      signingSecretFor: resolveSecret,
    });

    for (const one of receiver.received) {
      say(
        `receiver: ${one.type}, ${one.matches} matches — ${one.verified ? "VERIFIED" : "REJECTED"} (${one.reason})`,
      );
    }

    // 2. The same receiver, now holding a different secret. Without this the
    //    result above says only that two copies of one string are equal.
    held = "a-different-secret-entirely-0000000000000000000000000000000000";
    receiver.received.length = 0;
    await reset();

    say("delivering again, with the receiver holding somebody else's secret");
    await processNotifications(
      db,
      monitor.id,
      createNotificationTransport(notificationEnv),
      new Date(),
      { signingSecretFor: resolveSecret },
    );

    for (const one of receiver.received) {
      say(`receiver: ${one.verified ? "VERIFIED" : "REJECTED"} (${one.reason})`);
    }

    // 3. The hosted shape: the same URL, refused before the request.
    receiver.received.length = 0;
    await reset();

    say("delivering with the hosted guard on (AUTH_SIGNUP=open)");
    await processNotifications(
      db,
      monitor.id,
      createNotificationTransport(notificationEnv, { guardAddresses: true }),
      new Date(),
      { signingSecretFor: resolveSecret },
    );

    say(`receiver was asked ${receiver.received.length} times`);

    const [after] = await db
      .select({ error: notificationSettings.webhookError })
      .from(notificationSettings)
      .where(eq(notificationSettings.monitorId, monitor.id));

    say(`recorded reason: ${after?.error ?? "(none)"}`);

    const rows = await db
      .select({
        channel: notificationDeliveries.channel,
        status: notificationDeliveries.status,
        attempts: notificationDeliveries.attempts,
      })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.monitorId, monitor.id));

    for (const row of rows) {
      say(`delivery ${row.channel}: ${row.status}, ${row.attempts} attempt(s)`);
    }

    await receiver.close();
  } finally {
    await close();
  }
}

/**
 * Node reads `NODE_EXTRA_CA_CERTS` once, at start, so the certificate has to
 * exist before this process does. The first run makes one and re-runs itself.
 */
const scratch = process.env.LIVE_WEBHOOK_CERT_DIR;

if (!scratch) {
  const dir = mkdtempSync(join(tmpdir(), "signalscout-webhook-"));

  try {
    const made = makeCertificates(dir);
    const self = fileURLToPath(import.meta.url);

    execFileSync(process.execPath, ["--import", "tsx", self], {
      stdio: "inherit",
      env: {
        ...process.env,
        LIVE_WEBHOOK_CERT_DIR: dir,
        NODE_EXTRA_CA_CERTS: made.ca,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  certificates = {
    ca: join(scratch, "ca.pem"),
    cert: join(scratch, "leaf.pem"),
    key: join(scratch, "leaf.key"),
  };

  await main();
}
