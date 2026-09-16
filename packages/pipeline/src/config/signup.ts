/**
 * Whether a stranger may create an account, as the pipeline sees it.
 *
 * The application owns login; this is the one fact about it the pipeline
 * needs. US-081: on a closed instance the provider keys in `.env` belong to
 * the one account there is, and the worker may spend them on its behalf. On
 * an open one they belong to nobody, and a monitor polls only with keys its
 * owner stored. `worker/credentials.ts` reads this to tell the two apart.
 *
 * `closed` is the default, because every instance running today is
 * self-hosted, and a version bump that silently began accepting
 * registrations would hand somebody's instance to the first stranger who
 * found the login screen.
 */
export const signupModes = ["closed", "open"] as const;
export type SignupMode = (typeof signupModes)[number];

/**
 * The owner of every row written before an account existed. US-017.
 *
 * A row is stamped with this until the first account claims it, which the
 * application does at first login. The live scripts poll as this owner when
 * no account has been made yet.
 */
export const unclaimedUserId = "self-hosted";
