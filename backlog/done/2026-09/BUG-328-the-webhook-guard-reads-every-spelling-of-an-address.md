---
id: BUG-328
title: The webhook guard reads every spelling of an address
type: bug
priority: p1
created: 2026-09-23T06:15+08:00
parent: US-097
area: notifications
resolution: shipped
---

## Context

`isPublicAddress` in `packages/pipeline/src/notifications/address-guard.ts`
matched an IPv4-mapped IPv6 address only in its dotted spelling. The URL
parser always writes the hex one: `new URL("https://[::ffff:127.0.0.1]/")`
has the hostname `[::ffff:7f00:1]`, and `isPublicAddress("::ffff:7f00:1")`
was true. Loopback, the metadata address and the private ranges all passed.

Where signup is open, the API accepted such a webhook when it was saved. The
transport refused it at delivery only by accident: it passed the bracketed
hostname to the guard, which sent it to DNS, which could not resolve it. The
same accident made every IPv6 literal webhook fail, public or not.

Held in a private advisory, GHSA-rvp5-jj8c-wcw3, until a release carries the
fix. SECURITY.md.

## Acceptance

- [x] Every IPv6 check reads the address as eight groups, so compressed,
      expanded, dotted and hex spellings of one address get one answer.
- [x] `assertPublicHost` strips the brackets a URL keeps and checks the
      literal without a lookup.
- [x] Tests cover the hex spellings, an expanded spelling, the bracketed
      hostname, and the save route refusing a mapped URL.

## Notes

- **DNS rebinding is still open, and is written down in the file header.**
  Closing it needs the connection to use the checked address: Node's
  `fetch` accepts an undici `dispatcher`, and an undici `Agent` takes a
  `connect.lookup`. That adds `undici` as a dependency, which is the
  owner's decision, so it is not in this fix. The header's sentence that
  `fetch` offers no lookup is wrong and should change with that work.
- The hex handling also closes a quieter gap: loopback was matched as the
  string `::1`, so `0:0:0:0:0:0:0:1` passed.

## Log

- 2026-09-23T06:15+08:00 — Found in a review of the open repository, and
  reproduced with `tsx`: three hex-form private addresses were public at
  save time and failed at delivery only with `ENOTFOUND`.
- 2026-09-23T06:59+08:00 — Fixed. The two new guard tests and the new save-route case failed
  first (the route answered 200 to `https://[::ffff:127.0.0.1]/hook`) and
  pass now. Full suite: 132 files, 2,329 tests. Not run against a deployed
  instance.
