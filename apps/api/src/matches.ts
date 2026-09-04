/**
 * The HTTP side of the inbox.
 *
 * One route, and it holds no rules. The ordering, the hidden filter and the
 * page boundary all live in `@intentwatch/core`, for the reason `monitors.ts`
 * gives: the worker and the deletion job read the same rows, and a rule
 * written in a handler is a rule one caller obeys.
 *
 * Two decisions are this file's own. `asOf` is accepted from the client and
 * echoed back, because a page after the first must be ranked against the clock
 * the first page used, and the browser is what carries it between requests. And
 * a cursor is validated by shape here, so a hand-edited one answers 400 rather
 * than reaching the database as a comparison against nothing.
 */
import {
  cursorPattern,
  type Database,
  defaultPageSize,
  listMatches,
  maximumPageSize,
} from "@intentwatch/core";
import { z } from "zod";
import type { ApiServer } from "./server.js";

const matchSchema = z.object({
  id: z.string(),
  monitorId: z.string(),
  monitorName: z.string(),
  score: z.number(),
  rank: z.number(),
  relevance: z.number(),
  problemFit: z.number(),
  icpFit: z.number(),
  intent: z.number(),
  urgency: z.number(),
  intentType: z.string(),
  intentLabel: z.string(),
  reasons: z.array(z.string()),
  saved: z.boolean(),
  readAt: z.string().nullable(),
  source: z.string(),
  channel: z.string().nullable(),
  author: z.string().nullable(),
  title: z.string().nullable(),
  excerpt: z.string(),
  url: z.string(),
  postedAt: z.string(),
});

const query = z.object({
  monitorId: z.uuid().optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(maximumPageSize).default(defaultPageSize),
  cursor: z.string().regex(cursorPattern).optional(),
  /** The clock the first page was ranked against. Omitted on the first page. */
  asOf: z.iso.datetime().optional(),
});

export interface MatchRoutesOptions {
  readonly db: Database;
}

export async function registerMatchRoutes(
  app: ApiServer,
  { db }: MatchRoutesOptions,
): Promise<void> {
  app.route({
    method: "GET",
    url: "/api/matches",
    schema: {
      querystring: query,
      response: {
        200: z.object({
          matches: z.array(matchSchema),
          nextCursor: z.string().nullable(),
          asOf: z.string(),
        }),
      },
    },
    handler: async (request) => {
      const { monitorId, minScore, limit, cursor, asOf } = request.query;

      const page = await listMatches(db, {
        monitorId,
        minScore,
        limit,
        cursor,
        asOf: asOf ? new Date(asOf) : undefined,
      });

      return {
        matches: page.matches.map((match) => ({
          ...match,
          reasons: [...match.reasons],
          readAt: match.readAt?.toISOString() ?? null,
          postedAt: match.postedAt.toISOString(),
        })),
        nextCursor: page.nextCursor,
        asOf: page.asOf.toISOString(),
      };
    },
  });
}
