---
id: US-097
title: A webhook cannot be aimed at our own network
type: feature
priority: p1
created: 2026-09-10T00:52+08:00
parent:
area:
resolution:
---

## Context

**A webhook URL is a stranger's string and our worker makes the request.** On
the self-hosted instance that is the owner's own machine reaching the owner's
own network, and it is not a problem. On the cloud it is a tenant choosing an
address inside our infrastructure and having a trusted process fetch it. This
is the second of the two things that must be settled before webhooks are
offered to a cloud account, and
[US-096](US-096-a-webhook-secret-belongs-to-an-account.md) is the first.

**Three defences already exist and each does real work.** The URL must be
HTTPS, which rules out the plain-HTTP metadata endpoints. It may carry no
username or password. And `redirect: "error"` means a receiver cannot answer
with a 302 to somewhere else, which is the trick that defeats a check made only
at save time.

**What is absent is any question about where the name points.** An internal
service on HTTPS is reachable, and so is anything a tenant can get a public DNS
name to resolve at. The URL is validated for shape when it is saved and never
resolved, so a name that answers publicly at save time and privately at delivery
time is not considered at all.

**What leaks is small and it is not nothing.** The response body is discarded —
`await response.body?.cancel()` — so no content comes back into the product.
What a tenant learns is whether the request succeeded, from
`notification_settings.webhook_error` and the failure count on their own screen.
That is a reachability oracle, and the POST itself still happens.

**The fix belongs in the transport and not in the form.** A check at save time
is a check against the wrong moment: the address that matters is the one
resolved when the delivery is sent. The form should still refuse the obvious
cases, because a person who typed `localhost` deserves an answer immediately
rather than five failed attempts later — but the form's check is a courtesy and
the transport's is the guard.

**A self-hosted instance must not lose the ability to post to its own
network.** Somebody running this on a homelab pointing a webhook at another
container on the same host is the normal case there, and refusing it would
break a working deployment on upgrade. So the guard is tied to signup being
open, the way `machine-keys.ts` ties the key rule, rather than applied
everywhere.

## Acceptance

- [ ] Where signup is open, a delivery refuses an address that resolves to a
      private, loopback, link-local, unique-local or otherwise non-public
      address
- [ ] The check is made against the address the request will actually use, not
      only against the string that was saved
- [ ] Where signup is closed nothing changes: a self-hoster may still post to
      their own network, and no existing webhook stops working on upgrade
- [ ] The refusal is recorded as a webhook failure with a reason a person can
      act on, and it does not read as the receiver being down
- [ ] The form refuses the obvious cases as a courtesy, and the ticket records
      that this is not the guard
- [ ] A test drives each family of address, and one drives a name that resolves
      to a private address while looking public
- [ ] The existing three defences are asserted rather than assumed: HTTPS only,
      no credentials in the URL, and a redirect refused

## Notes

- Node's `undici` allows a custom lookup, which is where the resolved address
  can be inspected before the socket is used. Checking with `dns.lookup` first
  and then fetching is the version with a race in it: the name can answer
  differently the second time.
- Keep the failure distinct in the log from a receiver that refused. They send a
  person to different places, which is the reason `connections.ts` separates a
  400 from a 502.
- IPv6 matters here. An address like `::ffff:127.0.0.1` and the unique-local
  `fc00::/7` range both have to be covered, and a check written against IPv4
  strings will pass them.
- Out of scope: an allowlist of receiver hosts. Nobody has asked, and it would
  make every customer's first webhook a support request.

## Log

- 2026-09-10T00:52+08:00 — Written beside US-096 when the owner asked whether
  webhooks work on the cloud version and said they must be enabled there.
