# Webhooks on your own server

[Webhooks](../using/webhooks) holds the contract: the request, the
signature and the retries. Two things differ on a server you run.

## The signing secret

- **Without an account secret**, SignalScout signs with
  `WEBHOOK_SIGNING_SECRET` from `.env`. Make one with `openssl rand -hex 32`.
- **With sign-up open**, `WEBHOOK_SIGNING_SECRET` is never used, because
  every account could read it. Each account must generate its own.

## Where a webhook may point

Every instance requires an HTTPS URL, refuses a username or password inside
the URL, and does not follow redirects.

With sign-up open, the URL is a stranger's text, and your server makes the
request. So a webhook must then point to the public internet: `localhost` and
private network addresses are refused. On a server you run for yourself,
nothing more is refused, because a receiver in the next container is normal.
