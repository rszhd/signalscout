/**
 * The HTTP side of the inbox, and the two buttons on a match.
 *
 * These routes hold no rules. The ordering, the hidden filter, the page
 * boundary and what a verdict does to the list all live in
 * `@signalscout/core`, for the reason `monitors.ts` gives: the worker and the
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
  countNewMatches,
  csvFilename,
  cursorPattern,
  type Database,
  defaultPageSize,
  exportFeedback,
  type InboxMatch,
  listMatches,
  matchesToCsv,
  matchOrders,
  matchOwner,
  maximumPageSize,
  recordVerdict,
  setMatchSaved,
  verdicts,
} from "@signalscout/core";
import { z } from "zod";
import { sessionUserId } from "./auth.js";
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
  /**
   * What to order the page by. US-114.
   *
   * An enum rather than a free string: it names a column and an expression, so
   * an unknown value must be a 400 and never a silent fall back to the
   * default. A person paging with `order=newest` spelled wrong would otherwise
   * walk a rank-ordered list with a date cursor.
   *
   * The saved list ignores it, because that list's order is what it is.
   */
  order: z.enum(matchOrders).default("rank"),
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

/**
 * What the count route accepts. US-125.
 *
 * Picked from `query` rather than written again, so the two reads cannot drift
 * apart when the next filter is added. Paging and ordering are absent because
 * a count has neither.
 */
const countQuery = query
  .pick({
    monitorId: true,
    projectId: true,
    minScore: true,
    saved: true,
    includeNotRelevant: true,
  })
  .extend({
    /**
     * Count what arrived after this instant. Required.
     *
     * The client sends back the `asOf` of the page it is showing, which is the
     * moment that page was read. Required rather than defaulted: a missing
     * `since` would quietly ask the most expensive question this route can
     * answer, and the answer would be wrong on the screen as well.
     */
    since: z.iso.datetime(),
  });

/**
 * How many matches one page of the walk asks for.
 *
 * Larger than the screen's page because nobody is reading these one at a time,
 * and small enough that a single query stays quick.
 */
const exportPageSize = 200;

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
      const {
        monitorId,
        projectId,
        minScore,
        limit,
        cursor,
        asOf,
        includeNotRelevant,
        saved,
        order,
      } = request.query;

      const page = await listMatches(db, {
        userId: sessionUserId(request),
        monitorId,
        projectId,
        minScore,
        limit,
        cursor,
        includeNotRelevant,
        savedOnly: saved,
        order,
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
   * How many matches arrived since the screen last loaded. US-125.
   *
   * The inbox polls this on a timer and shows the answer as a banner. It
   * returns a number and never rows, because the list must not move while
   * somebody is reading it: the rank subtracts twelve points a day, so
   * re-reading the page on a timer would reorder every row under the cursor.
   * The person clicks the banner when they are ready, and that is the only
   * thing that reloads the list.
   *
   * The filters are `query`'s own fields, picked rather than retyped. A count
   * that did not narrow the way the list narrows would announce leads that are
   * not there when the banner is clicked, and a wrong count looks exactly like
   * a right one.
   */
  app.route({
    method: "GET",
    url: "/api/matches/count",
    schema: {
      querystring: countQuery,
      response: { 200: z.object({ count: z.number() }) },
    },
    handler: async (request) => {
      const { monitorId, projectId, minScore, includeNotRelevant, saved, since } = request.query;

      const count = await countNewMatches(db, {
        userId: sessionUserId(request),
        monitorId,
        projectId,
        minScore,
        includeNotRelevant,
        savedOnly: saved,
        since: new Date(since),
      });

      return { count };
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
      const result = await setMatchSaved(
        db,
        sessionUserId(request),
        request.params.id,
        request.body.saved,
      );

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
      /**
       * The match has to be in this person's inbox. US-017.
       *
       * Checked here rather than inside `recordVerdict`, because `feedback` is
       * one row per match per person by design and core keeps that. What this
       * route decides is narrower: you may judge what you can read. A match on
       * somebody else's monitor gets the same 404 an unknown id gets, because
       * telling the two apart would confirm the id.
       */
      if ((await matchOwner(db, request.params.id)) !== sessionUserId(request)) {
        return reply.code(404).send({ message: "No match has that id." });
      }

      const recorded = await recordVerdict(db, {
        userId: sessionUserId(request),
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
   * The inbox a person is looking at, as a spreadsheet. US-064.
   *
   * **The same filters as the screen**, so the file is the list they were
   * reading rather than a different one. A button that quietly exported
   * everything would be worse than no button: the person would not check.
   *
   * **Every page, not the first.** The screen paginates because a screen
   * should; a file should not. It walks the cursor until the list runs out,
   * bounded so a runaway query cannot build an unbounded string in memory.
   *
   * `Content-Disposition` is what makes a browser keep it, the same way
   * `/api/feedback/export` does for verdicts.
   */
  app.route({
    method: "GET",
    url: "/api/matches/export",
    schema: {
      // The same querystring the list takes, minus the paging: a file has no
      // pages. Sharing the schema is what stops the two drifting apart.
      querystring: query.omit({ cursor: true, limit: true }),
      response: { 200: z.string() },
    },
    handler: async (request, reply) => {
      const { monitorId, projectId, minScore, asOf, includeNotRelevant, saved, order } =
        request.query;

      const collected: InboxMatch[] = [];
      let cursor: string | null = null;
      let clock = asOf ? new Date(asOf) : undefined;

      /**
       * A ceiling on the walk, not on the export.
       *
       * Twenty pages of the maximum page size is more matches than any inbox
       * this product has produced, and it is here so a cursor that stopped
       * advancing could not spin for ever. If somebody ever hits it, the file
       * is short and the log line below says why.
       */
      for (let page = 0; page < 20; page += 1) {
        const answer = await listMatches(db, {
          userId: sessionUserId(request),
          monitorId,
          projectId,
          minScore,
          includeNotRelevant,
          savedOnly: saved,
          order,
          limit: exportPageSize,
          cursor,
          asOf: clock,
        });

        collected.push(...answer.matches);
        clock = answer.asOf;
        cursor = answer.nextCursor;

        if (!cursor) break;
      }

      if (cursor) {
        request.log.warn(
          { exported: collected.length },
          "the inbox export stopped at its page ceiling; the file is incomplete",
        );
      }

      const now = new Date();

      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="${csvFilename(now)}"`);

      return matchesToCsv(collected);
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
    handler: async (request, reply) => {
      const rows = await exportFeedback(db, sessionUserId(request));

      reply.header("content-disposition", 'attachment; filename="signalscout-feedback.json"');

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
