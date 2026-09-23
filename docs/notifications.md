# Notifications, for the people who change them

> **Setting up email or a webhook receiver?** That is on the site:
> [email](../site/self-hosting/email.md), [webhooks](../site/self-hosting/webhooks.md)
> (the contract a receiver is written from), and the
> [notifications screen](../site/using/notifications.md). This page holds the
> rules behind them, for a contributor.

A monitor delivers matches by digest, immediate email or signed webhook. The
code is `packages/pipeline/src/notifications/` and the `notify` queue.

---

## The defaults

**A new monitor emails its owner already** (US-093): a 24-hour digest at 50
and up, and an immediate email at 70 and up, to the address of the account
that created it. `settings.ts` holds the numbers, and both comparisons are
`>=`. Email is created **on** only where `SMTP_HOST` and `SMTP_FROM` are set,
so nothing is queued that cannot be delivered. **Webhooks start off**: there
is nothing to guess a URL from.

## The outbox

Postgres holds the settings, the deliveries and the match ids each delivery
carries. **The outbox holds ids, not content**: each attempt reads the
current matches and leaves out hidden ones, so a retry may carry fewer
matches than the first attempt, and its signature is computed over the new
body. An empty delivery is skipped.

- **Saving settings starts a new period.** Only matches created after the
  save are eligible, and pending deliveries under the old settings are
  cancelled, so a changed recipient never receives the previous recipient's
  backlog.
- **Concurrent workers serialise on the monitor's settings row.** A retry
  keeps its delivery id.
- **A delivery can be sent twice**: a process can die after the receiver
  accepted and before Postgres recorded it. That is why the contract tells a
  receiver to deduplicate the id. Email carries a stable `Message-ID`, which
  SMTP does not promise to honour.
- **Retries**: 30, 60, 120 and 240 seconds, rounded up to the worker's next
  tick. Five consecutive webhook failures, or five attempts at one delivery,
  disable the monitor's webhook. Email stops retrying a delivery after five
  attempts and stays enabled.
- **`notify` is a `stately` queue**, one queued job per singleton key, and
  every sender goes through `sendNotify`, which keys by monitor. A job sent
  with no key competes with every other monitor's and pg-boss drops the loser
  silently (BUG-021).

A pass that plans and sends nothing writes no `stage_runs` row: the
once-a-minute sweep visits every monitor with settings, and a row per visit
would be a history of the sweep rather than of the monitor (US-201).

## What an email is

US-094. A plain-text part and an HTML part; the text is the message, and the
HTML presents it.

- **The palette is copied** from `packages/ui/src/styles/tokens.css` into
  `email-theme.ts`, because a mail client has no external stylesheet and no
  CSS variables. **Change a colour in one and change it in the other.**
- Tables and inline styles, no image, no web font, and a declared light
  scheme so a dark-mode client does not invert it.
- **Everything interpolated is escaped, and only `http` and `https` URLs
  reach an `href`.** A digest is built from strangers' words; this is
  correctness, not tidiness.
- The *Open the inbox* button appears only where `APP_URL` is set. A link is
  never built from a request header.

## The signing secret

US-096. An account's own secret, in `webhook_secrets`, wins over
`WEBHOOK_SIGNING_SECRET`. Where `AUTH_SIGNUP=open` the instance's secret is
never used: one value every account is told to verify with lets any of them
sign a payload another's receiver accepts. That is `machine-keys.ts`'s rule,
the same one that keeps a stranger off the owner's provider keys.

A secret is 32 bytes as hex, the size `openssl rand -hex 32` makes, which
clears `WEBHOOK_SIGNING_SECRET`'s own 32-character minimum. It is signed per
attempt, not per delivery, so regenerating it stops every receiver holding
the old value at once, queued deliveries included. That is the repair for a
leaked secret.

## Where a webhook may point

US-097, and only where `AUTH_SIGNUP=open`: there a webhook URL is a
stranger's string and our worker makes the request, so private, loopback,
link-local, carrier-grade-NAT and unique-local addresses are refused.
`localhost` and a literal private address are refused on save; a name that
resolves privately is refused at send time, with the reason on the monitor's
notification screen. A self-hosted instance refuses none of it, because a
receiver in the next container is the normal case there.

Every instance requires HTTPS, refuses credentials in the URL, and refuses a
redirect rather than following it.

**One gap is left open on purpose: DNS rebinding.** The name is resolved to
check it and resolved again by the HTTP client, so a server the attacker
controls can answer publicly the first time and privately the second. Closing
it needs the connection to use the checked address, which `fetch` does not
allow. What the window offers is a blind `POST` and a reachability signal; the
response body is discarded.

## Proving it

`pnpm --filter @signalscout/pipeline live:webhook` starts an HTTPS receiver
written from the site's [webhook page](../site/self-hosting/webhooks.md) and
nothing else, and delivers to it. It spends nothing. It proves three things:
a delivery signed with the account's secret verifies, the same receiver
holding a different secret rejects one, and with the address guard on, the
same URL is refused before the request. Re-run it after any change to
signing or to the address rules.

**What has run for real**, and the ticket that holds the evidence: mail
reached an inbox through Resend on a verified domain (US-092, US-094); a new
monitor notified its owner unasked (US-093); a signed webhook verified
(`live:webhook`). **Still unproven**: an email opened in Outlook, and a
webhook reaching a receiver on another machine, over a real TLS chain and a
real DNS answer.
