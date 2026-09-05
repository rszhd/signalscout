# Notifications

Open **Monitors → Notifications** for the monitor you want to configure.
Email and webhooks start disabled. Enabling email uses a daily digest with a
minimum score of 50. The interval and score floor are editable. Quiet periods
send nothing. An optional immediate email threshold starts at 90.
Immediate alerts also appear in the next digest.

Saving settings starts a new period. Only matches created after that save are
eligible. Pending deliveries under the previous settings are cancelled, so a
changed recipient never receives the previous recipient's backlog. The inbox
keeps all of those matches.

A digest includes up to 100 matches per message. Larger periods are split into
several deliveries. A paused monitor can still deliver matches already found.
The worker checks for due notifications once a minute. After downtime it picks
up eligible matches that have not been assigned a delivery.

## SMTP and Resend

IntentWatch uses Nodemailer, a Node.js library, to send through your SMTP
provider. There is no separate Nodemailer account or service.

For Resend, put these settings in `.env`:

```dotenv
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASSWORD=your-resend-api-key
SMTP_FROM=alerts@your-verified-domain.example
```

Use your own API key and an address on your verified domain.
[Resend documents these SMTP settings](https://resend.com/docs/send-with-nodemailer-smtp).
Restart the API and worker after changing the environment. Docker Compose
passes the same settings to both processes.

Port 465 uses TLS from connection time. Port 587 uses STARTTLS; the app requires
that upgrade and never sends credentials over an unencrypted connection.
`SMTP_SECURE=false` selects STARTTLS, not plaintext mail.

Another SMTP provider uses the same variables. An SMTP relay without
username/password authentication may leave both `SMTP_USER` and
`SMTP_PASSWORD` empty. `SMTP_HOST` and `SMTP_FROM` are required for email.
Without them the app and inbox work, and the notification screen names what
is missing.

SMTP acceptance means the server accepted the message. It does not prove inbox
placement or delivery beyond that server. Bounces and spam filtering remain
with your provider. SMTP charges are outside the monitor's source/model budget.

## Webhook contract

Set `WEBHOOK_SIGNING_SECRET` to a random value of at least 32 characters, and
configure the same value at your receiver. Generate one with:

```bash
openssl rand -hex 32
```

The secret stays in the environment. It is never returned by the API or stored
in a notification row. All monitors on an instance use this signing key.
Rotate it by updating the receiver and both application processes together.

The URL must use HTTPS, with no username, password or fragment. Redirects are
refused. Choose **Digest** or **Each match above the minimum score**. A request
is a JSON `POST`. Its body has this versioned shape:

```json
{
  "version": 1,
  "id": "delivery-uuid",
  "type": "matches.digest",
  "createdAt": "2026-09-05T00:00:00.000Z",
  "monitor": { "id": "monitor-uuid", "name": "QA conversations" },
  "matches": [
    {
      "id": "match-uuid",
      "score": 90,
      "reasons": ["A small team asks for help with testing"],
      "source": "reddit",
      "url": "https://www.reddit.com/r/example/comments/example",
      "excerpt": "How do other small teams test before a release?",
      "author": "example",
      "postedAt": "2026-09-04T23:00:00.000Z"
    }
  ]
}
```

`type` is `match.created` for a single match and `matches.digest` for a digest.
`author` may be null. Times are UTC ISO 8601 strings. `createdAt` is when the
outbox delivery was created. This is our payload example, not a provider fixture.
The payload is generic JSON. Slack and Discord need a receiver that translates
it to their own message format; their incoming webhook URLs are not directly
compatible with this contract.

Headers:

- `Content-Type: application/json`
- `X-IntentWatch-Id`: the delivery UUID, stable across retries
- `X-IntentWatch-Timestamp`: the attempt time, in Unix seconds
- `X-IntentWatch-Signature`: `v1=` followed by a hexadecimal HMAC-SHA256

Verify the HMAC over `timestamp + "." + rawBody`, using the signing secret.
Read the original request bytes before parsing JSON. Compare signatures in
constant time, reject timestamps more than five minutes from your clock, and
deduplicate the delivery UUID after accepting a delivery. Do not mark an id
processed until the work has been durably accepted.

Any 2xx response accepts the delivery. An error, redirect, timeout or other
status fails it. Requests time out after 15 seconds. Failed deliveries retry
after 30, 60, 120 and 240 seconds, rounded up to the worker's next tick. Five
consecutive webhook failures disable the monitor's webhook. A delivery that
fails five times also disables it. Other channels remain independent.

Failures appear on the monitor card and the notification settings screen.
Fix the receiver, enable the webhook and save to start with future matches.
Email also stops retrying a delivery after five attempts, and reports the
failure on those screens. It does not disable future email deliveries.

## What persistence guarantees

Postgres holds the settings, delivery state and the match ids assigned to each
delivery. Concurrent workers serialize on the monitor's settings row. A retry
uses the same delivery id. Successfully recorded deliveries are not sent again.

A process can die after a receiver accepted a delivery but before Postgres
recorded it. The retry can then duplicate that delivery. Webhook receivers must
deduplicate the id. Email carries a stable `Message-ID`, but SMTP does not
promise to deduplicate it.

The outbox holds ids, not copies of post content. Each attempt reads the current
matches and excludes hidden ones. An empty delivery is skipped. A retry's body
may therefore contain fewer matches than an earlier attempt; its signature is
computed again over the current body.

## Verification

The suite uses real Postgres, pg-boss and a local TLS SMTP receiver. It checks
our Nodemailer integration without sending to an external account. Resend inbox
delivery and a real third-party webhook receiver have not been exercised by
US-016. Those remain unproven until a live send is explicitly requested and a
recipient or receiver is supplied.
