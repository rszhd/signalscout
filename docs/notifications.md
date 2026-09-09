# Notifications

Open **Monitors → Notifications** for the monitor you want to configure.

**A new monitor emails its owner already.** US-093. It is created with a daily
digest of matches scoring 50 or more, and an immediate email for anything above
70, sent to the account address of whoever created it. The interval, the score
floor and the immediate threshold are all editable, and email can be switched
off. Quiet periods send nothing. Immediate alerts also appear in the next
digest.

Email is on only where the deployment can send it. An instance with no
`SMTP_HOST` or `SMTP_FROM` creates the monitor with email off, and this screen
names what is missing. So nothing is queued that cannot be delivered.

**Webhooks start disabled**, and stay that way until you give a URL. There is
nothing to guess.

Only matches found after a monitor is created are eligible. Nothing already in
an inbox is posted as a backlog.

Saving settings starts a new period. Only matches created after that save are
eligible. Pending deliveries under the previous settings are cancelled, so a
changed recipient never receives the previous recipient's backlog. The inbox
keeps all of those matches.

A digest includes up to 100 matches per message. Larger periods are split into
several deliveries. A paused monitor can still deliver matches already found.
The worker checks for due notifications once a minute. After downtime it picks
up eligible matches that have not been assigned a delivery.

## What an email looks like

US-094. Every message carries a plain-text part and an HTML part. The text is
the message and the HTML is a presentation of it, so a client that shows only
text loses the styling and nothing else.

The palette is copied from `apps/web/src/styles/tokens.css` into
`packages/core/src/notifications/email-theme.ts`, because a mail client has no
external stylesheet and no CSS variables. **Change a colour in one and change
it in the other.** The copy is deliberate and it is made once: that file holds
the palette and the shared shell, and the two templates beside it render
through it.

The templates lay out with tables and inline styles, load no image and no web
font, and declare a light scheme with their own background so a dark-mode
client does not invert them. A match links to the post it came from. The
"open the inbox" button appears only where `APP_URL` is set.

Everything interpolated is escaped, and only `http` and `https` URLs reach an
`href`. A digest is built from strangers' words, so this is correctness and not
tidiness.

## SMTP and Resend

SignalScout uses Nodemailer, a Node.js library, to send through your SMTP
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
in a notification row. Rotate it by updating the receiver and both application
processes together.

### An account can have its own

US-096. **Monitors → Notifications** has a *Generate a secret* button. It makes
one for your account, shows it once, and never shows it again — copy it into
your receiver before you leave the page. Every monitor you own signs with it.

An account's own secret wins over `WEBHOOK_SIGNING_SECRET`. An account without
one falls back to the environment, which is why a self-hosted instance that
already has a receiver configured keeps working unchanged after an upgrade.

Generating a new secret stops every receiver holding the old value from
verifying, immediately and including deliveries already queued — a pending
delivery is signed at each attempt, not once. That is the repair for a leaked
secret and there is no other. Deleting the account's secret goes back to the
instance's.

An instance with no `ENCRYPTION_KEY` cannot store one, and the screen says so.

**Where `AUTH_SIGNUP=open`, the instance's own secret is not used at all.** It
would be one value shared by every account, and each of them is told to verify
with it — so any of them could sign a payload another's receiver accepts as
genuine. On such an instance an account must generate its own, and until it
does, its webhooks report `WEBHOOK_SIGNING_SECRET` as missing. This is
`machine-keys.ts`'s rule, the same one that stops a stranger spending the
owner's provider keys.

### Where a webhook may point

US-097, and it applies **only where `AUTH_SIGNUP=open`**. There a webhook URL is
a stranger's string and our worker makes the request, so a receiver must be on
the public internet: a private, loopback, link-local, carrier-grade-NAT or
unique-local address is refused. `localhost` and a literal private address are
refused as you save, and a name that resolves privately is refused when the
delivery is sent, with the reason on the monitor's notification screen rather
than a generic failure.

On a self-hosted instance nothing is refused. The network is already the
owner's, and a receiver in another container on the same host is the normal
case there.

Three older defences still stand on every instance: the URL must be HTTPS, it
may carry no username or password, and a redirect is refused rather than
followed.

**One gap is left open on purpose: DNS rebinding.** The name is resolved to
check it and resolved again by the HTTP client, so a server the attacker
controls can answer publicly the first time and privately the second. Closing it
needs the connection to use the address that was checked, which `fetch` does not
allow. What the window offers is a blind `POST` and a reachability signal — the
response body is discarded and never reaches the product.

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
- `X-SignalScout-Id`: the delivery UUID, stable across retries
- `X-SignalScout-Timestamp`: the attempt time, in Unix seconds
- `X-SignalScout-Signature`: `v1=` followed by a hexadecimal HMAC-SHA256

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
