/**
 * The verification email's dressed half. US-094.
 *
 * The text is US-092's and is asserted elsewhere. What is new is that the
 * message now carries HTML beside it, through the same shell the digest uses —
 * so the two emails a person receives from this product look like one product.
 */
import { describe, expect, it } from "vitest";
import { verificationMessage } from "./verification-email.js";

const url = "https://app.example.test/verify?token=abc123";

describe("the verification email is dressed like the rest of the product", () => {
  it("keeps the plain text exactly as it was", () => {
    const { text } = verificationMessage("Harith", url);

    expect(text).toContain("Hello Harith,");
    expect(text).toContain(url);
    expect(text).toContain("The link works for 24 hours.");
  });

  it("puts the link in a button and prints it underneath", () => {
    // A client that will not render the button still shows an address a person
    // can copy, and somebody who wants to read a link before opening it can.
    const { html } = verificationMessage("Harith", url);

    expect(html).toContain(`href="${url}"`);
    expect(html).toContain("Confirm this address");
    expect(html).toContain("word-break:break-all");
  });

  it("uses the same shell as a digest", () => {
    const { html } = verificationMessage("", url);

    expect(html).toContain("SignalScout");
    expect(html).toContain("color-scheme:light");
    expect(html).toContain("#36578f");
    expect(html).toContain("Hello, confirm this address");
  });

  it("escapes a name somebody chose", () => {
    // A display name is typed at registration and reaches this message.
    const { html } = verificationMessage("<script>alert(1)</script>", url);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders no link at all for a URL it will not trust", () => {
    // eslint-disable-next-line no-script-url
    const { html } = verificationMessage("Harith", "javascript:alert(1)");

    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("Confirm this address");
  });
});
