import type {
  CandidatePost,
  CredentialCheck,
  CredentialField,
  SearchRequest,
  SearchResult,
  SocialSource,
  SourceCredentials,
  SourceDefinition,
  SourceRuntime,
} from "../types.js";
import { fakePosts } from "./fixtures.js";

/**
 * A source that implements the whole interface and touches no network.
 *
 * This is not a test convenience. Every later ticket drives the collector, the
 * filter, the classifier and the budget guard through this, because the two
 * real sources cost money per read and a test loop does not stop when the
 * assertion passes. So the fake owes those tickets more than a happy path: it
 * must be able to run out of allowance and to hand back a short page, which are
 * the two shapes a caller gets wrong.
 */
export const fakeSourceId = "fake";

const defaultCredentialFields: readonly CredentialField[] = [
  { name: "token", label: "Token", secret: true },
];

export interface FakeSourceOptions {
  /** Register the same fake twice under different ids to test a fan-out. */
  readonly id?: string;
  readonly displayName?: string;
  readonly posts?: readonly CandidatePost[];
  /**
   * Posts per page. Set it below the caller's `limit` to hand back a short
   * page that still has more behind it — the case where a caller that stops
   * on `posts.length < limit` loses everything after the first page.
   */
  readonly pageSize?: number;
  /** Searches served before the allowance runs out. Unlimited by default. */
  readonly callsBeforeRateLimit?: number;
  /** How long the allowance takes to come back. */
  readonly rateLimitWindowMs?: number;
  /**
   * What the connector does when the allowance is gone.
   *
   * `"report"` hands the wait up as `next.status === "wait"`. `"sleep"` backs
   * off inside the connector and then serves the page. Both are legal
   * connector behaviour and neither tells the caller how the limit was found.
   */
  readonly backOff?: "report" | "sleep";
  /** Units billed for the call itself. Reddit bills this way: one call, up to 100 posts. */
  readonly unitsPerCall?: number;
  /** Units billed per post returned. X bills this way. */
  readonly unitsPerPost?: number;
  readonly pricePerUnitMicros?: number;
  /** What one query costs in one poll. US-014 projects a month from it. */
  readonly maxUnitsPerQueryPoll?: number;
  readonly billableUnit?: string;
  readonly credentialFields?: readonly CredentialField[];
  /** Exact credentials that pass. Any non-empty value passes when this is unset. */
  readonly validCredentials?: SourceCredentials;
}

export interface FakeSource extends SocialSource {
  /** Every search, in order. A test asserts what was not called as well as what was. */
  readonly calls: readonly SearchRequest[];
}

/** Build a connector definition the registry can hold. */
export function fakeSourceDefinition(options: FakeSourceOptions = {}): SourceDefinition {
  const id = options.id ?? fakeSourceId;

  return {
    id,
    displayName: options.displayName ?? "Fake",
    billableUnit: options.billableUnit ?? "call",
    pricePerUnitMicros: options.pricePerUnitMicros ?? 0,
    maxUnitsPerQueryPoll: options.maxUnitsPerQueryPoll ?? 50,
    credentialFields: options.credentialFields ?? defaultCredentialFields,
    create: (runtime) => createFakeSource(runtime, options),
  };
}

export function createFakeSource(
  runtime: SourceRuntime,
  options: FakeSourceOptions = {},
): FakeSource {
  const descriptor = fakeSourceDefinition(options);
  const posts = options.posts ?? fakePosts;
  const pageSize = options.pageSize ?? posts.length;
  const allowance = options.callsBeforeRateLimit ?? Number.POSITIVE_INFINITY;
  const windowMs = options.rateLimitWindowMs ?? 60_000;
  const backOff = options.backOff ?? "report";
  const unitsPerCall = options.unitsPerCall ?? 1;
  const unitsPerPost = options.unitsPerPost ?? 0;

  const calls: SearchRequest[] = [];
  let remaining = allowance;
  /** Set once the allowance is spent. The allowance returns when the clock passes it. */
  let windowEndsAt: Date | undefined;

  function check(credentials: SourceCredentials): CredentialCheck {
    for (const field of descriptor.credentialFields) {
      const value = credentials[field.name];
      if (!value) return { valid: false, reason: `Missing ${field.label}.` };

      const expected = options.validCredentials?.[field.name];
      if (expected !== undefined && expected !== value) {
        return { valid: false, reason: `${field.label} is not accepted.` };
      }
    }

    return { valid: true };
  }

  return {
    ...descriptor,
    calls,

    validateCredentials: (credentials) => Promise.resolve(check(credentials)),

    async search(request: SearchRequest): Promise<SearchResult> {
      calls.push(request);

      request.signal?.throwIfAborted();

      const credentials = check(request.credentials);
      if (!credentials.valid) {
        throw new Error(`${descriptor.id}: ${credentials.reason}`);
      }

      const now = runtime.now();
      if (windowEndsAt && now.getTime() >= windowEndsAt.getTime()) {
        remaining = allowance;
        windowEndsAt = undefined;
      }

      if (remaining <= 0) {
        const retryAfter = windowEndsAt ?? new Date(now.getTime() + windowMs);

        if (backOff === "report") {
          // Nothing was fetched, so nothing was billed.
          return {
            posts: [],
            unitsConsumed: 0,
            next:
              request.cursor === undefined
                ? { status: "wait", retryAfter }
                : { status: "wait", retryAfter, cursor: request.cursor },
          };
        }

        // The other legal answer: wait here, and let the caller see a normal
        // page. The caller never learns that this source has an allowance.
        await runtime.sleep(Math.max(0, retryAfter.getTime() - now.getTime()));
        remaining = allowance;
        windowEndsAt = undefined;
      }

      remaining -= 1;
      if (remaining <= 0) {
        windowEndsAt = new Date(runtime.now().getTime() + windowMs);
      }

      const since = request.query.since;
      const matching = since ? posts.filter((post) => post.postedAt > since) : posts;

      const offset = readCursor(request.cursor, matching.length, descriptor.id);
      const take = Math.min(pageSize, request.limit ?? Number.POSITIVE_INFINITY);
      const page = matching.slice(offset, offset + take);
      const nextOffset = offset + page.length;

      return {
        posts: page,
        unitsConsumed: unitsPerCall + unitsPerPost * page.length,
        next:
          nextOffset < matching.length
            ? { status: "ready", cursor: String(nextOffset) }
            : { status: "done" },
      };
    },
  };
}

/**
 * A cursor is opaque to the caller, so one it invented is a bug in the caller
 * and must not read as an empty page.
 */
function readCursor(cursor: string | undefined, total: number, id: string): number {
  if (cursor === undefined) return 0;

  const offset = Number(cursor);
  if (!Number.isInteger(offset) || offset < 0 || offset > total) {
    throw new Error(`${id}: cursor "${cursor}" was not issued by this source.`);
  }

  return offset;
}
