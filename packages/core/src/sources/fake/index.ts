import type {
  CandidatePost,
  CandidateReply,
  ConnectorDefinition,
  CredentialCheck,
  CredentialField,
  ReplyRequest,
  SearchRequest,
  SearchResult,
  SocialSource,
  SourceCredentials,
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

/**
 * The fake's own provider. A test that says nothing about providers gets one,
 * because a connector is a pair and a fake that was only half of one would
 * make the registry's checks unreachable from a test.
 */
export const fakeProviderId = "fake-provider";

const defaultCredentialFields: readonly CredentialField[] = [
  { name: "token", label: "Token", secret: true },
];

export interface FakeSourceOptions {
  /** The platform. Register the same fake twice under different ids to test a fan-out. */
  readonly id?: string;
  readonly displayName?: string;
  /** The provider. Two fakes on one platform is what a provider choice looks like. */
  readonly providerId?: string;
  readonly providerName?: string;
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
  /**
   * The replies this fake serves, keyed by the post's `externalId`. US-020.
   *
   * Absent means this connector cannot read replies at all, which is the
   * common case and the one worth being able to express: a monitor that asks
   * for replies on such a platform must still poll and still return posts.
   *
   * A function answers for any post, which is what a test whose subject is the
   * rule rather than the payload wants: it can build a thread whose ids belong
   * to the post it hangs under, and two tests then never share a reply row.
   */
  readonly replies?:
    | Readonly<Record<string, readonly CandidateReply[]>>
    | ((postExternalId: string) => readonly CandidateReply[]);
  /** Units billed for one call to `fetchReplies`. */
  readonly unitsPerReplyCall?: number;
  /**
   * Called with every reply request, so a caller's own arguments can be
   * asserted — the date window most of all, which no returned value shows.
   */
  readonly onFetchReplies?: (request: ReplyRequest) => void;
  /**
   * What the fake reports as `ReplyResult.partial`.
   *
   * Defaults to true, which is what both real providers report almost always:
   * a top-level "no more" arrives on threads that are missing half their
   * comments, so completeness is claimed only from positive evidence.
   */
  readonly repliesPartial?: boolean;
}

export interface FakeSource extends SocialSource {
  /** Every search, in order. A test asserts what was not called as well as what was. */
  readonly calls: readonly SearchRequest[];
  /** Every reply fetch, in order, for the same reason. */
  readonly replyCalls: readonly ReplyRequest[];
}

/** Build a connector definition the registry can hold. */
export function fakeSourceDefinition(options: FakeSourceOptions = {}): ConnectorDefinition {
  return {
    platform: {
      id: options.id ?? fakeSourceId,
      displayName: options.displayName ?? "Fake",
    },
    provider: {
      id: options.providerId ?? fakeProviderId,
      displayName: options.providerName ?? "Fake Provider",
      credentialFields: options.credentialFields ?? defaultCredentialFields,
    },
    billableUnit: options.billableUnit ?? "call",
    pricePerUnitMicros: options.pricePerUnitMicros ?? 0,
    maxUnitsPerQueryPoll: options.maxUnitsPerQueryPoll ?? 50,
    canFetchReplies: options.replies !== undefined,
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
  const replyCalls: ReplyRequest[] = [];
  let remaining = allowance;
  /** Set once the allowance is spent. The allowance returns when the clock passes it. */
  let windowEndsAt: Date | undefined;

  function check(credentials: SourceCredentials): CredentialCheck {
    for (const field of descriptor.provider.credentialFields) {
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
    replyCalls,

    validateCredentials: (credentials) => Promise.resolve(check(credentials)),

    /**
     * Present only when the fake was given replies, because absence is how a
     * connector says it cannot read them and a test needs to drive that too.
     */
    ...(options.replies === undefined
      ? {}
      : {
          fetchReplies: (request: ReplyRequest) => {
            replyCalls.push(request);
            options.onFetchReplies?.(request);

            const replies =
              typeof options.replies === "function"
                ? options.replies(request.postExternalId)
                : (options.replies?.[request.postExternalId] ?? []);

            return Promise.resolve({
              replies,
              unitsConsumed: options.unitsPerReplyCall ?? 1,
              next: { status: "done" as const },
              partial: options.repliesPartial ?? true,
            });
          },
        }),

    async search(request: SearchRequest): Promise<SearchResult> {
      calls.push(request);

      request.signal?.throwIfAborted();

      const credentials = check(request.credentials);
      if (!credentials.valid) {
        throw new Error(`${descriptor.platform.id}: ${credentials.reason}`);
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

      const offset = readCursor(request.cursor, matching.length, descriptor.platform.id);
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
