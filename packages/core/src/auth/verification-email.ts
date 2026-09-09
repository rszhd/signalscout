/**
 * The message that carries the link. US-092.
 *
 * Plain text, like every other message this product sends: US-016's transport
 * takes a subject and a body, and a second format would be a second thing to
 * keep true. It is also the format that reaches a person whose client refuses
 * remote content, which is the client somebody reads a verification mail in.
 *
 * The URL is Better Auth's own — it carries the signed token — and it is
 * printed on a line of its own rather than wrapped in words, because a mail
 * client that does not linkify it leaves a person copying it by hand.
 */

/** How a message leaves this instance. US-016's transport, narrowed. */
export type SendEmail = (to: string, subject: string, text: string, id: string) => Promise<void>;

export interface VerificationMessage {
  readonly subject: string;
  readonly text: string;
}

/**
 * What the person reads.
 *
 * It names the product and says what happens if they did nothing, because an
 * unexpected verification mail means somebody typed this address into a
 * registration form — and the honest answer is that ignoring it costs nothing,
 * since no session exists until the link is opened.
 */
export function verificationMessage(name: string, url: string): VerificationMessage {
  const greeting = name.trim() ? `Hello ${name.trim()},` : "Hello,";

  return {
    subject: "Confirm your email address for SignalScout",
    text: [
      greeting,
      "",
      "Open this link to confirm your address and finish signing in:",
      "",
      url,
      "",
      "The link works for 24 hours. Signing in again sends a new one.",
      "",
      "If you did not create a SignalScout account, ignore this message.",
      "Nobody is signed in until the link above is opened.",
    ].join("\n"),
  };
}
