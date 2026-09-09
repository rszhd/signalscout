/**
 * Where a webhook may not be pointed. US-097.
 *
 * Correctness-critical on a hosted instance. A rule about addresses is only as
 * good as the family it forgot, so this enumerates rather than samples — and
 * the two easiest things to get wrong each have their own case: an IPv4-mapped
 * IPv6 address, and a name that looks public and resolves privately.
 */
import { describe, expect, it } from "vitest";
import {
  assertPublicHost,
  isPublicAddress,
  PrivateAddressError,
  type ResolveHost,
} from "./address-guard.js";

const answering =
  (...addresses: string[]): ResolveHost =>
  async () =>
    addresses;

describe("which addresses are the public internet's", () => {
  it("accepts an ordinary routable address", () => {
    for (const address of [
      "93.184.216.34",
      "8.8.8.8",
      "1.1.1.1",
      "2606:2800:220:1:248:1893:25c8:1946",
    ]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("refuses every private and special-purpose IPv4 range", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "127.0.0.1",
      "100.64.0.1", // carrier-grade NAT
      "169.254.169.254", // the metadata endpoint every cloud exposes
      "172.16.0.1",
      "172.31.255.254",
      "192.0.0.1",
      "192.0.2.1",
      "192.88.99.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1", // multicast
      "255.255.255.255",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("keeps the edges of the private ranges on the right side", () => {
    // The boundary is where an off-by-one hides. 172.15 and 172.32 are public;
    // everything between is not.
    expect(isPublicAddress("172.15.255.255")).toBe(true);
    expect(isPublicAddress("172.32.0.1")).toBe(true);
    expect(isPublicAddress("100.63.255.255")).toBe(true);
    expect(isPublicAddress("100.128.0.1")).toBe(true);
    expect(isPublicAddress("223.255.255.255")).toBe(true);
  });

  it("refuses the IPv6 families, including link-local and unique-local", () => {
    for (const address of [
      "::",
      "::1",
      "fe80::1", // link-local
      "feb0::1",
      "fc00::1", // unique-local
      "fd12:3456::1",
      "ff02::1", // multicast
      "2001:db8::1", // documentation
      "64:ff9b::1", // NAT64
      "100::1", // discard-only
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("unwraps an IPv4-mapped IPv6 address rather than waving it through", () => {
    // The mistake a check written against IPv4 strings makes. `::ffff:127.0.0.1`
    // is loopback wearing a different hat.
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:169.254.169.254")).toBe(false);
    expect(isPublicAddress("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:93.184.216.34")).toBe(true);
  });

  it("ignores a zone index, which is part of the address a client accepts", () => {
    expect(isPublicAddress("fe80::1%eth0")).toBe(false);
  });

  it("refuses anything that is not an address at all", () => {
    // Every caller has already parsed a URL, so this is a shape nobody
    // expected, and refusing is the safe direction.
    expect(isPublicAddress("localhost")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
  });
});

describe("checking a hostname before the request", () => {
  it("passes a name that resolves publicly", async () => {
    await expect(
      assertPublicHost("receiver.example", answering("93.184.216.34")),
    ).resolves.toBeUndefined();
  });

  it("refuses a name that looks public and resolves privately", async () => {
    /**
     * The attack this exists for. The URL passes every check made when it was
     * saved — HTTPS, no credentials, a public-looking name — and points inside
     * our network at the moment the delivery is sent.
     */
    await expect(
      assertPublicHost("receiver.example", answering("169.254.169.254")),
    ).rejects.toThrow(PrivateAddressError);
    await expect(assertPublicHost("receiver.example", answering("10.1.2.3"))).rejects.toThrow(
      "which is not a public address",
    );
  });

  it("refuses when any one of several addresses is private", async () => {
    // Which address is connected to is the client's choice and not ours, so one
    // private answer among public ones is a way through.
    await expect(
      assertPublicHost("receiver.example", answering("93.184.216.34", "127.0.0.1")),
    ).rejects.toThrow(PrivateAddressError);
  });

  it("checks a literal address without asking a resolver", async () => {
    // Passing a literal to a resolver is how a check gets skipped by something
    // that does not recognise its own input.
    const never: ResolveHost = async () => {
      throw new Error("the resolver was called for a literal address");
    };

    await expect(assertPublicHost("127.0.0.1", never)).rejects.toThrow(PrivateAddressError);
    await expect(assertPublicHost("[::1]".replaceAll(/[[\]]/g, ""), never)).rejects.toThrow(
      PrivateAddressError,
    );
    await expect(assertPublicHost("93.184.216.34", never)).resolves.toBeUndefined();
  });

  it("leaves a name that resolves to nothing alone", async () => {
    // The request fails on its own. Inventing a refusal here would report a
    // private address where there was a typo.
    await expect(assertPublicHost("receiver.example", answering())).resolves.toBeUndefined();
  });
});
