/**
 * The message that carries the link. US-092, dressed by US-094.
 *
 * The plain text is the message and the HTML is a presentation of it. Both are
 * sent, and the text below is unchanged: it is what reaches a person whose
 * client refuses remote content, which is exactly the client somebody reads a
 * verification mail in.
 *
 * The URL is Better Auth's own — it carries the signed token — and the text
 * version prints it on a line of its own rather than wrapping it in words,
 * because a mail client that does not linkify it leaves a person copying it by
 * hand. The HTML version puts it in a button *and* prints it underneath, for
 * the same reason.
 */
import {
  emailFont,
  emailPalette,
  escapeHtml,
  renderButton,
  renderShell,
} from "../notifications/email-theme.js";

/** How a message leaves this instance. US-016's transport, narrowed. */
export type SendEmail = (
  to: string,
  subject: string,
  text: string,
  id: string,
  html?: string,
) => Promise<void>;

export interface VerificationMessage {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
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

  const p = emailPalette;

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
    html: renderShell({
      preheading: `${greeting} confirm this address to finish signing in.`,
      body: [
        renderButton(url, "Confirm this address"),
        // The link in full, under the button. A client that will not render
        // the button still shows an address a person can copy, and somebody
        // who wants to read a link before opening it can.
        `<p style="margin:16px 0 0;font-family:${emailFont};font-size:13px;line-height:1.5;`,
        ` color:${p.muted};word-break:break-all;">${escapeHtml(url)}</p>`,
        `<p style="margin:16px 0 0;font-family:${emailFont};font-size:14px;line-height:1.55;`,
        ` color:${p.mutedStrong};">The link works for 24 hours. Signing in again sends a new`,
        " one.</p>",
      ].join(""),
      footer:
        "If you did not create a SignalScout account, ignore this message. " +
        "Nobody is signed in until the link above is opened.",
    }),
  };
}
