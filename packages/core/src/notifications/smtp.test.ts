/** Our own local SMTP receiver. No account, external recipient or provider. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type TLSSocket } from "node:tls";
import nodemailer from "nodemailer";
import { expect, it } from "vitest";
import { loadNotificationEnv } from "../config/env.js";
import { createNotificationTransport } from "./transport.js";

it("delivers an email through Nodemailer over a real TLS SMTP connection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "iw-smtp-"));
  const sockets = new Set<TLSSocket>();
  let message = "";
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "ignore" },
  );
  const server = createServer(
    {
      key: readFileSync(join(directory, "key.pem")),
      cert: readFileSync(join(directory, "cert.pem")),
    },
    (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.setEncoding("utf8");
      socket.write("220 localhost SMTP\r\n");
      let buffer = "";
      let data = false;
      socket.on("data", (chunk) => {
        buffer += chunk;
        while (buffer.includes("\r\n")) {
          const end = buffer.indexOf("\r\n");
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (data) {
            if (line === ".") {
              data = false;
              socket.write("250 accepted\r\n");
            } else message += `${line}\r\n`;
          } else if (line.startsWith("EHLO")) socket.write("250 localhost\r\n");
          else if (line === "DATA") {
            data = true;
            socket.write("354 send message\r\n");
          } else if (line === "QUIT") socket.end("221 goodbye\r\n");
          else socket.write("250 OK\r\n");
        }
      });
    },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No SMTP port");
    const transport = createNotificationTransport(
      loadNotificationEnv({
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(address.port),
        SMTP_SECURE: "true",
        SMTP_FROM: "alerts@example.com",
      }),
      {
        // Only this local test trusts its own ephemeral certificate.
        mailer: (options) =>
          nodemailer.createTransport({ ...options, tls: { rejectUnauthorized: false } }),
      },
    );
    assert(transport.email);
    await transport.email(
      "owner@example.com",
      "A useful match",
      "Score: 90\nA team asks for help",
      "smtp-integration",
    );
    expect(message).toContain("To: owner@example.com");
    expect(message).toContain("Subject: A useful match");
    expect(message).toContain("Message-ID: <smtp-integration@intentwatch.local>");
    expect(message).toContain("Score: 90");
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
