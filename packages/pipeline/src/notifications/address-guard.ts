/**
 * Where a webhook may not be pointed. US-097.
 *
 * Correctness-critical on a hosted instance, and the failure shape is a tenant
 * choosing an address inside our own network and having a trusted process fetch
 * it. Self-hosted this is not a fault at all: the machine, the network and the
 * webhook are the same person's, and refusing a homelab container talking to
 * another container on the same host would break a working deployment on
 * upgrade. So the guard is tied to signup being open, the way `machine-keys.ts`
 * ties the key rule.
 *
 * **Three defences already existed and each does real work.** HTTPS only, which
 * rules out the plain-HTTP metadata endpoints every cloud exposes. No username
 * or password in the URL. And `redirect: "error"`, so a receiver cannot answer
 * with a 302 to somewhere else — which is the trick that defeats a check made
 * only when the URL is saved.
 *
 * What was absent is any question about where the name *points*, and that is
 * what this file adds.
 *
 * **What it does not close: DNS rebinding.** The name is resolved here and
 * resolved again by the HTTP client, so an authoritative server the attacker
 * controls can answer publicly the first time and privately the second. Closing
 * that needs the connection itself to use the address we checked, which needs a
 * custom `lookup` on the request — `node:https` offers one and `fetch` does
 * not. It is written down rather than hidden: what a tenant gains through that
 * window is a blind POST and a reachability signal, because the response body
 * is discarded and never reaches the product.
 */
import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";

/** An IPv4 address as four numbers, or null when it is not one. */
function octets(address: string): [number, number, number, number] | null {
  if (!isIPv4(address)) return null;

  const parts = address.split(".").map(Number);
  return parts.length === 4 ? (parts as [number, number, number, number]) : null;
}

/**
 * Whether an IPv4 address is one the public internet routes to somebody else.
 *
 * The list is RFC 6890's special-purpose registry, not a guess. Carrier-grade
 * NAT (100.64/10) and the benchmarking range (198.18/15) are on it because both
 * appear inside real infrastructure, and the documentation ranges are on it
 * because a receiver in one is a mistake worth refusing rather than a target.
 */
function isPublicIPv4(address: string): boolean {
  const parts = octets(address);
  if (!parts) return false;

  const [a, b, c] = parts;

  if (a === 0) return false; // "this network"
  if (a === 10) return false; // private
  if (a === 127) return false; // loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, and the metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false; // documentation
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
  if (a === 192 && b === 168) return false; // private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  if (a >= 224) return false; // multicast, reserved, and the broadcast address

  return true;
}

/**
 * Whether an IPv6 address is public.
 *
 * **An IPv4-mapped address is unwrapped and judged as IPv4.** `::ffff:127.0.0.1`
 * is loopback wearing a different hat, and a check written against IPv4 strings
 * alone waves it through — which is the mistake this function exists to not
 * make.
 */
/**
 * The eight 16-bit groups of an IPv6 address, or null when it is not one.
 *
 * Every check below reads these numbers rather than the text, because one
 * address has many spellings: `::1` and `0:0:0:0:0:0:0:1`, or
 * `::ffff:127.0.0.1` and `::ffff:7f00:1`, which is the one a URL produces.
 * A check written against one spelling passes the others (BUG-328).
 */
function hextets(address: string): number[] | null {
  let value = address;

  // A dotted IPv4 tail is two groups written another way.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (dotted?.[1]) {
    const parts = octets(dotted[1]);
    if (!parts) return null;
    const high = ((parts[0] << 8) | parts[1]).toString(16);
    const low = ((parts[2] << 8) | parts[3]).toString(16);
    value = `${value.slice(0, -dotted[1].length)}${high}:${low}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const numbers = groups.map((group) =>
    /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN,
  );

  return numbers.some(Number.isNaN) ? null : numbers;
}

function isPublicIPv6(address: string): boolean {
  const groups = hextets(address.toLowerCase().split("%")[0] ?? "");
  if (!groups) return false;

  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = groups;
  const firstFive = a === 0 && b === 0 && c === 0 && d === 0 && e === 0;

  // Unspecified and loopback: `::` and `::1`, however they are written.
  if (firstFive && f === 0 && g === 0 && h <= 1) return false;

  // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96): the last 32 bits
  // are an IPv4 address, and it is that address the connection reaches.
  if (firstFive && (f === 0xffff || f === 0)) {
    return isPublicIPv4(`${g >> 8}.${g & 0xff}.${h >> 8}.${h & 0xff}`);
  }

  if ((a & 0xffc0) === 0xfe80) return false; // link-local, fe80::/10
  if ((a & 0xfe00) === 0xfc00) return false; // unique-local, fc00::/7
  if ((a & 0xff00) === 0xff00) return false; // multicast
  if (a === 0x2001 && b === 0x0db8) return false; // documentation
  if (a === 0x0064 && b === 0xff9b) return false; // NAT64
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return false; // discard-only

  return true;
}

export function isPublicAddress(address: string): boolean {
  if (isIPv4(address)) return isPublicIPv4(address);
  if (isIPv6(address)) return isPublicIPv6(address);

  // Not an address at all. Refusing is the safe direction: every caller here
  // has already parsed a URL, so this is a shape nobody expected.
  return false;
}

export class PrivateAddressError extends Error {
  constructor(
    readonly hostname: string,
    readonly address: string,
  ) {
    super(
      `"${hostname}" resolves to ${address}, which is not a public address. ` +
        "A webhook on this instance may only be sent to a receiver on the public internet.",
    );
    this.name = "PrivateAddressError";
  }
}

/** How a hostname becomes addresses. Injected so a test needs no DNS. */
export type ResolveHost = (hostname: string) => Promise<readonly string[]>;

export const resolveHost: ResolveHost = async (hostname) => {
  const found = await lookup(hostname, { all: true, verbatim: true });
  return found.map((entry) => entry.address);
};

/**
 * Throw unless every address this hostname resolves to is public.
 *
 * **Every** address and not the first, because a name answering with one public
 * and one private address would otherwise be a way through: which one is
 * connected to is the client's choice and not ours.
 *
 * A name that resolves to nothing is left alone. The request will fail on its
 * own, and inventing a refusal here would report a private address where there
 * was a typo.
 */
export async function assertPublicHost(hostname: string, resolve: ResolveHost): Promise<void> {
  // `URL.hostname` keeps the brackets on an IPv6 literal, and a bracketed
  // literal is neither an address to `isIPv6` nor a name a resolver knows.
  const bare =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  // A literal address needs no lookup, and passing one to a resolver is how a
  // check gets skipped by something that does not recognise its own input.
  if (isIPv4(bare) || isIPv6(bare)) {
    if (!isPublicAddress(bare)) throw new PrivateAddressError(hostname, bare);
    return;
  }

  const addresses = await resolve(bare);

  for (const address of addresses) {
    if (!isPublicAddress(address)) throw new PrivateAddressError(hostname, address);
  }
}
