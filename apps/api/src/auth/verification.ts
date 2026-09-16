/**
 * Whether an address is proven before an account is used. US-092.
 *
 * The check here is `billing/config.ts`'s, for the same class of failure and
 * in the opposite direction. A deployment that asks for verification and
 * cannot send mail is not a deployment with a broken feature: it is a login
 * that refuses everybody, including the owner, with a message about an email
 * that was never sent. So the mode and the transport are one question, asked
 * once, at boot.
 *
 * `off` needs nothing and checks nothing. That is the common install — no
 * SMTP, one account, and a person who typed their own address at a keyboard
 * they are sitting in front of.
 */

/**
 * What a deployment does with the address somebody registers with.
 *
 * `off` is the default and it is the self-hosted shape: the address is taken
 * as given, and a session starts the moment the account exists.
 *
 * `required` is the cloud shape. Nobody is signed in until a link sent to the
 * address is opened, which is what stops one person registering with another
 * person's address — holding it for ever, because the column is unique — and
 * what stops a fresh seven-day trial being minted from an address nobody has
 * to reach.
 *
 * The default is off rather than required, and the reason is the upgrade.
 * Every instance running today is self-hosted and most of them have no SMTP at
 * all, so a version bump that quietly began requiring a link would arrive as a
 * login that refuses the owner, on a machine they run for themselves.
 *
 * `optional` is the obvious third value — send the link, let them in anyway —
 * and it is deliberately absent. It buys none of the three things above, and
 * it is what somebody would choose to avoid deciding.
 */
export const emailVerificationModes = ["off", "required"] as const;
export type EmailVerificationMode = (typeof emailVerificationModes)[number];

export interface EmailVerificationEnvironment {
  readonly AUTH_EMAIL_VERIFICATION?: EmailVerificationMode;
  readonly SMTP_HOST?: string | undefined;
  readonly SMTP_FROM?: string | undefined;
}

/**
 * The variables a `required` deployment must set, in the order a person reads
 * them.
 *
 * Two, and they are the two `notificationReadiness` calls the floor of a
 * working mailer: a host to reach and an address to send from. The user and
 * the password are not here, because a relay on a private network may want
 * neither and refusing to boot over an optional credential would be a check
 * that is wrong more often than it is right.
 */
export const requiredVerificationVariables = ["SMTP_HOST", "SMTP_FROM"] as const;

/**
 * Whether this deployment requires a verified address, checked against whether
 * it can send one.
 *
 * Throws in `required` mode when mail is not configured, naming every missing
 * variable at once rather than one per restart.
 */
export function emailVerificationRequired(env: EmailVerificationEnvironment): boolean {
  const mode = env.AUTH_EMAIL_VERIFICATION ?? "off";
  if (mode === "off") return false;

  const missing = requiredVerificationVariables.filter((name) => !env[name]);

  if (missing.length > 0) {
    throw new Error(
      `AUTH_EMAIL_VERIFICATION is "required", so nobody is signed in until they open a link, ` +
        `but ${missing.join(", ")} is not set.\n` +
        "Without a mail server the link is never sent, so this instance would refuse every " +
        "account it has, including yours.\n" +
        "Set the SMTP variables in .env, or set AUTH_EMAIL_VERIFICATION=off.\n",
    );
  }

  return true;
}
