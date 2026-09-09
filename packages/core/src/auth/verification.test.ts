/**
 * What a deployment must set before it may ask for a verified address. US-092.
 *
 * The second case is the one that matters. `AUTH_EMAIL_VERIFICATION=required`
 * with no mail server is not a feature that fails: it is a login that refuses
 * every account on the instance, the owner's included, with a message about a
 * link nobody posted. Nothing on the screen says the mail server is the cause,
 * which is why it is a refusal to boot rather than a warning.
 */
import { describe, expect, it } from "vitest";
import { emailVerificationRequired, requiredVerificationVariables } from "./verification.js";
import { verificationMessage } from "./verification-email.js";

const withMail = {
  AUTH_EMAIL_VERIFICATION: "required" as const,
  SMTP_HOST: "smtp.example.test",
  SMTP_FROM: "signalscout@example.test",
};

describe("whether an address is verified", () => {
  it("asks nothing of a deployment that does not verify", () => {
    expect(emailVerificationRequired({})).toBe(false);
    expect(emailVerificationRequired({ AUTH_EMAIL_VERIFICATION: "off" })).toBe(false);
    // Even with a mail server configured. The mode is the switch, and SMTP set
    // for US-016's digests must not turn a login requirement on by itself.
    expect(emailVerificationRequired({ ...withMail, AUTH_EMAIL_VERIFICATION: "off" })).toBe(false);
  });

  it("requires it where the deployment says so and can send", () => {
    expect(emailVerificationRequired(withMail)).toBe(true);
  });

  it("refuses to run when it could never send the link", () => {
    expect(() => emailVerificationRequired({ AUTH_EMAIL_VERIFICATION: "required" })).toThrow(
      /SMTP_HOST, SMTP_FROM/,
    );
  });

  it("names every missing variable at once, not one per restart", () => {
    for (const missing of requiredVerificationVariables) {
      const partial = { ...withMail, [missing]: undefined };

      expect(() => emailVerificationRequired(partial)).toThrow(new RegExp(missing));
    }
  });

  it("says what to do about it, in the message itself", () => {
    let thrown = "";
    try {
      emailVerificationRequired({ AUTH_EMAIL_VERIFICATION: "required" });
    } catch (error) {
      thrown = (error as Error).message;
    }

    expect(thrown).toContain("AUTH_EMAIL_VERIFICATION=off");
    expect(thrown).toContain("refuse every account");
  });
});

describe("the message that carries the link", () => {
  it("puts the URL on a line of its own, so it can be copied", () => {
    const { text } = verificationMessage(
      "Alex",
      "https://app.example.test/api/auth/verify-email?token=x",
    );

    expect(text.split("\n")).toContain("https://app.example.test/api/auth/verify-email?token=x");
  });

  it("greets a person by name, and greets one without a name too", () => {
    expect(verificationMessage("Alex", "https://x.test").text).toContain("Hello Alex,");
    expect(verificationMessage("   ", "https://x.test").text).toContain("Hello,");
  });

  /**
   * The message reaches somebody who did not register, whenever an address is
   * typed wrongly or on purpose. What they need is permission to ignore it,
   * which is only true because no session exists until the link is opened.
   */
  it("tells a stranger that ignoring it costs nothing", () => {
    const { text } = verificationMessage("Alex", "https://x.test");

    expect(text).toContain("ignore this message");
    expect(text).toContain("Nobody is signed in until the link above is opened.");
  });

  it("names the product in the subject, because a bare 'confirm' is spam", () => {
    expect(verificationMessage("Alex", "https://x.test").subject).toContain("SignalScout");
  });
});
