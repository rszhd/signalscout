/**
 * The digest and the immediate alert, as a person reads them. US-094.
 *
 * The plain text this replaces was a join of scores, excerpts and URLs. It is
 * kept, unchanged in meaning, and the HTML is added beside it: `sendMail` takes
 * both, a text-only client and a screen reader lose nothing, and a multipart
 * message scores better with a spam filter than an HTML-only one.
 *
 * **What a match row shows, and why in this order.** The score first, because
 * it is what makes the list scannable and it is the number the thresholds are
 * set against. Then the excerpt, which is the person's own words. Then the
 * model's reasons, quietly, because they explain the score rather than being
 * the lead. Then where it came from and a link to it.
 *
 * Every one of those values is a stranger's, so every one is escaped. See
 * `email-theme.ts`.
 */
import {
  emailFont,
  emailPalette,
  escapeHtml,
  renderButton,
  renderShell,
  safeUrl,
} from "./email-theme.js";

export interface MatchRow {
  readonly score: number;
  readonly reasons: readonly string[];
  readonly source: string;
  readonly url: string;
  readonly excerpt: string;
  readonly author: string | null;
  readonly postedAt: Date;
}

export interface MatchEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** How old the post is, in the words a person would use. */
function age(postedAt: Date, now: Date): string {
  const hours = Math.max(0, Math.round((now.getTime() - postedAt.getTime()) / 3_600_000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/**
 * One match, as a bordered block.
 *
 * A table per match rather than one table of rows: Outlook's renderer handles
 * a border and a radius on a single-cell table and mangles a bordered `tr`.
 */
function renderMatch(row: MatchRow, now: Date): string {
  const p = emailPalette;
  const href = safeUrl(row.url);
  const where = [row.source, row.author ? `@${row.author}` : null, age(row.postedAt, now)]
    .filter((part): part is string => part !== null)
    .join(" · ");

  const reasons = row.reasons
    .map((reason) => `<li style="margin:0 0 4px;">${escapeHtml(reason)}</li>`)
    .join("");

  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`,
    ` style="margin:0 0 12px;"><tr><td style="background:${p.surfaceSoft};`,
    ` border:1px solid ${p.line};border-radius:10px;padding:16px;">`,

    // The score, in the accent, beside where the post came from.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `<td style="font-family:${emailFont};font-size:20px;font-weight:700;color:${p.accentText};`,
    ` line-height:1;">${row.score}</td>`,
    `<td align="right" style="font-family:${emailFont};font-size:13px;color:${p.muted};">`,
    `${escapeHtml(where)}</td>`,
    "</tr></table>",

    `<p style="margin:12px 0 0;font-family:${emailFont};font-size:15px;line-height:1.55;`,
    ` color:${p.ink};">${escapeHtml(row.excerpt)}</p>`,

    reasons
      ? `<ul style="margin:12px 0 0;padding-left:18px;font-family:${emailFont};font-size:13px;` +
        ` line-height:1.5;color:${p.muted};">${reasons}</ul>`
      : "",

    href
      ? `<p style="margin:12px 0 0;font-family:${emailFont};font-size:14px;">` +
        `<a href="${escapeHtml(href)}" style="color:${p.accentText};text-decoration:underline;">` +
        "Read the conversation</a></p>"
      : // A URL we will not put in an href is still worth showing, as text.
        `<p style="margin:12px 0 0;font-family:${emailFont};font-size:13px;color:${p.muted};">` +
        `${escapeHtml(row.url)}</p>`,

    "</td></tr></table>",
  ].join("");
}

/**
 * The whole message.
 *
 * `appUrl` is the instance's own address and is optional on purpose: a
 * self-hosted deployment need not have set `APP_URL`, and a button pointing
 * nowhere is worse than no button. A match always links to its own post, which
 * needs nothing configured.
 */
export function matchEmail(options: {
  readonly monitorName: string;
  readonly matches: readonly MatchRow[];
  readonly kind: "digest" | "match";
  readonly appUrl?: string | undefined;
  readonly now?: Date;
}): MatchEmail {
  const { monitorName, matches, kind } = options;
  const now = options.now ?? new Date();
  const count = matches.length;
  const noun = count === 1 ? "match" : "matches";

  // Unchanged: a filter somebody already wrote against this must keep working.
  const subject = `SignalScout: ${count} ${noun} for ${monitorName}`;

  const text = `${subject}\n\n${matches
    .map((row) => `Score: ${row.score}\n${row.excerpt}\n${row.reasons.join("\n")}\n${row.url}`)
    .join("\n\n")}\n`;

  const preheading =
    kind === "digest"
      ? `${count} ${noun} for ${monitorName} since the last digest.`
      : `A new match for ${monitorName}, scored ${matches[0]?.score ?? 0}.`;

  const inbox = options.appUrl ? renderButton(options.appUrl, "Open the inbox") : "";

  const html = renderShell({
    preheading,
    body: matches.map((row) => renderMatch(row, now)).join("") + inbox,
    footer:
      "A match is this product's guess, not a verdict. Mark the ones that were " +
      "useful in the inbox, and change what arrives here on the monitor's " +
      "notification settings.",
  });

  return { subject, text, html };
}
