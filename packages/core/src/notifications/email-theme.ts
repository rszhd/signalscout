/**
 * The look of every email this product sends. US-094.
 *
 * **Why the palette is copied.** `docs/design.md` says `apps/web/src/styles/
 * tokens.css` is the source of truth, and it stays the source of truth for the
 * application. An email cannot read it. There is no external stylesheet in a
 * mail client, no CSS custom property in Outlook's Word renderer, no flexbox
 * and no grid — so the values are copied here, each one named for the token it
 * came from, and they are copied exactly **once**. A palette copied into each
 * template is a palette that drifts in three places until two emails disagree
 * about the blue.
 *
 * Changing a colour in `tokens.css` means changing it here too. That cost is
 * real and it is the reason this file is small: six colours and one shell,
 * rather than a second design system.
 *
 * **The rules an email renderer forces, and why each is obeyed:**
 *
 * * **Tables, not `div`s.** Outlook on Windows lays out with Word. A flex row
 *   collapses into a stack and a grid is ignored entirely.
 * * **Inline styles.** A `<style>` block is stripped by Gmail's web client on
 *   forwarded mail and by several others outright.
 * * **No web font.** Figtree will not load. The fallback stack in `tokens.css`
 *   is what everybody sees, so it is what is written here.
 * * **No image and no tracking pixel.** A logo needs a hosted URL, is blocked
 *   by default in most clients, and a remote image in a notification is a read
 *   receipt nobody asked for. The wordmark is text.
 * * **Light only**, because the site theme is. A message with no background of
 *   its own is inverted by a dark-mode client into grey on near-black, so the
 *   shell paints its own and declares `color-scheme: light`.
 *
 * **Everything interpolated is escaped, and that is correctness-critical.** A
 * digest is built from strangers' words — a post title, an excerpt, an author
 * name, a model's reasons. Unescaped, a title carrying `<img onerror=…>` is
 * markup in somebody's mail client. US-064 learned the same lesson about
 * spreadsheet formulas in the same content, and the reason is identical: this
 * text is data and must never be able to become instructions.
 */

/**
 * The palette, copied from `apps/web/src/styles/tokens.css`.
 *
 * The token name is beside each value so a person changing one can find the
 * other. Nothing here is a new colour: adding one would make this a second
 * design system rather than a copy of the first.
 */
export const emailPalette = {
  /** --ink */
  ink: "#151a22",
  /** --muted */
  muted: "#626b78",
  /** --muted-strong */
  mutedStrong: "#414b59",
  /** --background */
  background: "#f7f8fa",
  /** --surface */
  surface: "#ffffff",
  /** --surface-soft */
  surfaceSoft: "#f5f7fa",
  /** --line */
  line: "#e5e8ed",
  /** --accent */
  accent: "#48679f",
  /** --accent-soft */
  accentSoft: "#edf2fa",
  /** --accent-text */
  accentText: "#36578f",
  /** --text-on-accent */
  onAccent: "#ffffff",
} as const;

/**
 * The font stack from `tokens.css`, without Figtree.
 *
 * Naming a font a client cannot load costs a render nothing, but it invites
 * somebody to add a `@font-face` that will never work. The stack below is what
 * every reader actually gets.
 *
 * **`Segoe UI` is quoted with apostrophes and that is not a style choice.**
 * Every style here is written into a double-quoted HTML attribute, so a double
 * quote inside the value ends the attribute: the first version of this file
 * produced `style="font-family:… , "Segoe UI", Roboto…"`, where the style
 * stopped at the space before `Segoe` and the rest of the declaration became
 * stray attributes on the tag. Single quotes are valid CSS in the same place
 * and survive it. `assertNoDoubleQuote` below is what keeps it true.
 */
export const emailFont =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** --radius-md, as a plain value: a mail client has no variables. */
const radius = "12px";

/**
 * Escape text for HTML.
 *
 * Five characters, which is the whole set that matters in element content and
 * in a double-quoted attribute. Applied to **every** interpolated value without
 * exception — a value that "cannot contain markup" is a value somebody will
 * later make user-supplied.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A URL safe to put in `href`, or null.
 *
 * A post URL arrives from a provider and a provider's answer is not ours. Only
 * `http` and `https` reach an attribute; anything else — `javascript:`,
 * `data:`, a relative string that a client resolves against its own origin —
 * is dropped and the link is rendered as plain text instead.
 */
export function safeUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export interface EmailShell {
  /** The line under the wordmark. One short sentence, already plain text. */
  readonly preheading: string;
  /** The rendered body rows, already escaped. */
  readonly body: string;
  /** The closing line, already plain text. */
  readonly footer: string;
}

/**
 * The frame every message shares: the wordmark, the reading surface, the rule
 * and the footer.
 *
 * One shell rather than one per template, for the reason `groupByPlatform` is
 * one function: two copies of a layout is two layouts, and the second one is
 * always the one nobody looked at.
 */
export function renderShell({ preheading, body, footer }: EmailShell): string {
  const p = emailPalette;

  return [
    `<div style="margin:0;padding:0;background:${p.background};color-scheme:light;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`,
    ` style="background:${p.background};padding:24px 12px;">`,
    '<tr><td align="center">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`,
    ` style="max-width:600px;width:100%;font-family:${emailFont};">`,

    // The wordmark. Text, not an image: see the header comment.
    `<tr><td style="padding:0 4px 12px;font-size:15px;font-weight:600;color:${p.accentText};`,
    ` letter-spacing:0.01em;">SignalScout</td></tr>`,

    `<tr><td style="background:${p.surface};border:1px solid ${p.line};border-radius:${radius};`,
    ` padding:24px;">`,
    `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:${p.mutedStrong};">`,
    `${escapeHtml(preheading)}</p>`,
    body,
    "</td></tr>",

    `<tr><td style="padding:16px 4px 0;font-size:13px;line-height:1.5;color:${p.muted};">`,
    `${escapeHtml(footer)}</td></tr>`,

    "</table></td></tr></table></div>",
  ].join("");
}

/**
 * The blue action button.
 *
 * A table rather than a padded anchor, because Outlook ignores padding on an
 * inline element and the button collapses to its text.
 */
export function renderButton(url: string, label: string): string {
  const p = emailPalette;
  const href = safeUrl(url);
  if (!href) return "";

  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0;">`,
    `<tr><td style="background:${p.accent};border-radius:8px;">`,
    `<a href="${escapeHtml(href)}"`,
    ` style="display:inline-block;padding:11px 18px;font-family:${emailFont};font-size:15px;`,
    ` font-weight:600;color:${p.onAccent};text-decoration:none;">${escapeHtml(label)}</a>`,
    "</td></tr></table>",
  ].join("");
}
