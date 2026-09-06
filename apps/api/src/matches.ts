/**
 * The HTTP side of the inbox, and the two buttons on a match.
 *
 * These routes hold no rules. The ordering, the hidden filter, the page
 * boundary and what a verdict does to the list all live in
 * `@intentwatch/core`, for the reason `monitors.ts` gives: the worker and the
 * deletion job read the same rows, and a rule written in a handler is a rule
 * one caller obeys.
 *
 * Three decisions are this file's own. `asOf` is accepted from the client and
 * echoed back, because a page after the first must be ranked against the clock
 * the first page used, and the browser is what carries it between requests. A
 * cursor is validated by shape here, so a hand-edited one answers 400 rather
 * than reaching the database as a comparison against nothing. And a verdict is
 * `PUT` rather than `POST`: one person has one verdict on one match, so
 * sending it twice must leave one, and a retried request after a dropped
 * connection must not read as a change of mind.
 */
import {
  cursorPattern,
  type Database,
  defaultPageSize,
  exportFeedback,
  listMatches,
  maximumPageSize,
  recordVerdict,
  setMatchSaved,
  verdicts,
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
  /** Null when this person has not judged the match. Not a third verdict. */
  verdict: z.enum(verdicts).nullable(),
  readAt: z.string().nullable(),
  source: z.string(),
  channel: z.string().nullable(),
  author: z.string().nullable(),
  title: z.string().nullable(),
  excerpt: z.string(),
  url: z.string(),
  postedAt: z.string(),
  /** "post" or "reply". US-020. */
  kind: z.string(),
  /**
   * The thread above a reply, so the inbox can show what the model was shown.
   *
   * Null on a post, and on a reply whose post has since been deleted. A person
   * asked to judge a reply with less context than the classifier had is being
   * asked the wrong question.
   */
  parentTitle: z.string().nullable(),
  parentExcerpt: z.string().nullable(),
  parentUrl: z.string().nullable(),
  /**
   * How much of the thread was read, of how much there is, and why it ended.
   *
   * US-048. A comment is read as a sample of a conversation, and the size of
   * the sample changes what the absence of other leads means.
   */
  parentRepliesRead: z.number().nullable(),
  parentReplyCount: z.number().nullable(),
  parentRepliesStopped: z.string().nullable(),
});

const query = z.object({
  monitorId: z.uuid().optional(),
  /** Every monitor in one project. US-045: a project has its own inbox. */
  projectId: z.uuid().optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(maximumPageSize).default(defaultPageSize),
  /**
   * Only what this person kept. US-043.
   *
   * A separate list rather than a filter on the inbox: it is ordered by when
   * things were saved, and it shows a kept match whatever its verdict, because
   * somebody who judged a match weak and kept it anyway meant both.
   */
  saved: z.stringbool().default(false),
  cursor: z.string().regex(cursorPattern).optional(),
  /** The clock the first page was ranked against. Omitted on the first page. */
  asOf: z.iso.datetime().optional(),
  /**
   * Show the matches this person marked not relevant. They are hidden by
   * default and never deleted, so this is how somebody reviews what they
   * dismissed — and how they undo one.
   */
  includeNotRelevant: z.stringbool().default(false),
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
      const { monitorId, projectId, minScore, limit, cursor, asOf, includeNotRelevant, saved } =
        request.query;

      const page = await listMatches(db, {
        monitorId,
        projectId,
        minScore,
        limit,
        cursor,
        includeNotRelevant,
        savedOnly: saved,
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

  /**
   * Keep a match, or stop keeping it. US-043.
   *
   * A `PUT` of the state rather than a `POST` of an action, so pressing the
   * button twice is the same as pressing it once — a person on a slow
   * connection who taps again must not toggle themselves back off.
   *
   * It is deliberately not the verdict route wearing a different name. A
   * verdict is a judgement about the model and is stored against the monitor
   * version that earned it; this is an intention, and it survives a
   * re-classification because the person's intention is theirs.
   */
  app.route({
    method: "PUT",
    url: "/api/matches/:id/saved",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ saved: z.boolean() }),
      response: {
        200: z.object({
          matchId: z.string(),
          saved: z.boolean(),
          /** When it was kept, or null. The saved list is ordered by it. */
          savedAt: z.string().nullable(),
        }),
        404: z.object({ message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const result = await setMatchSaved(db, request.params.id, request.body.saved);

      if (!result) return reply.code(404).send({ message: "No match has that id." });

      return {
        matchId: result.matchId,
        saved: result.savedAt !== null,
        savedAt: result.savedAt?.toISOString() ?? null,
      };
    },
  });

  /**
   * Give a verdict on a match, or change the one already given.
   *
   * The response is the verdict now in force, not the match. The screen turns
   * the button on from this and removes the row itself; re-reading the page
   * would move every other row under the person's cursor, because the rank
   * depends on a clock.
   */
  app.route({
    method: "PUT",
    url: "/api/matches/:id/verdict",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ verdict: z.enum(verdicts) }),
      response: {
        200: z.object({
          matchId: z.string(),
          monitorId: z.string(),
          monitorVersion: z.number(),
          verdict: z.enum(verdicts),
          createdAt: z.string(),
          /** True when this replaced a different verdict. */
          changed: z.boolean(),
        }),
        404: z.object({ message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const recorded = await recordVerdict(db, {
        matchId: request.params.id,
        verdict: request.body.verdict,
      });

      if (!recorded) return reply.code(404).send({ message: "No match has that id." });

      return {
        matchId: recorded.matchId,
        monitorId: recorded.monitorId,
        monitorVersion: recorded.monitorVersion,
        verdict: recorded.verdict,
        createdAt: recorded.createdAt.toISOString(),
        changed: recorded.changed,
      };
    },
  });

  /**
   * Every verdict this instance holds, as a file.
   *
   * US-012 asks for feedback that survives a reinstall, so this is a download
   * and not a page: `Content-Disposition` is what makes a browser keep it. The
   * superseded rows are in it, and so are the post's source and external id,
   * because the ids of an instance that no longer exists mean nothing.
   */
  app.route({
    method: "GET",
    url: "/api/feedback/export",
    schema: {
      response: {
        200: z.object({
          exportedAt: z.string(),
          verdicts: z.array(
            z.object({
              matchId: z.string(),
              monitorId: z.string(),
              monitorName: z.string(),
              monitorVersion: z.number(),
              userId: z.string(),
              verdict: z.enum(verdicts),
              score: z.number(),
              source: z.string(),
              externalId: z.string(),
              url: z.string(),
              title: z.string().nullable(),
              createdAt: z.string(),
              supersededAt: z.string().nullable(),
            }),
          ),
        }),
      },
    },
    handler: async (_request, reply) => {
      const rows = await exportFeedback(db);

      reply.header("content-disposition", 'attachment; filename="intentwatch-feedback.json"');

      return {
        exportedAt: new Date().toISOString(),
        verdicts: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          supersededAt: row.supersededAt?.toISOString() ?? null,
        })),
      };
    },
  });
}
