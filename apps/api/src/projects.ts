/**
 * The HTTP side of a project. US-045.
 *
 * A route is a shape check and a status code. Every rule lives in
 * `@signalscout/pipeline`, for the reason `monitors.ts` gives: the worker reads the
 * same rows, so a rule written here would be one caller's rule.
 *
 * One decision shows through in the shapes below. A `PATCH` body has no
 * defaults and every field is optional, because US-022's bug was a body schema
 * that filled the keys a request did not carry and erased the fields behind
 * them. `updateProject` reads absence as "leave it", and this schema is what
 * lets absence survive the wire.
 */
import {
  createProject,
  type Database,
  fetchDocument,
  getProject,
  listProjects,
  matches,
  maximumDocumentCharacters,
  monitors,
  type ProjectDescriber,
  projects,
  readUploadedDocument,
  recordModelCall,
  signals as signalIds,
  updateProject,
} from "@signalscout/pipeline";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { sessionUserId } from "./auth.js";
import type { ApiServer } from "./server.js";

export interface ProjectRoutesOptions {
  readonly db: Database;
  /**
   * Null when this deployment has no model key. US-050.
   *
   * The screen asks rather than assuming: a self-hoster with no key still has
   * a working product and types the four answers themselves, so the drafting
   * button is absent rather than broken.
   */
  readonly describer?: ProjectDescriber | null;
  /**
   * The per-account fallback. US-068.
   *
   * The option above stays an override — a test passes one, and `null` still
   * means "this deployment has none". This is what is used when it is absent,
   * and it is a function of the person asking because they pay for the call.
   */
  readonly describerFor?: (userId: string) => Promise<ProjectDescriber | null>;
}

const signal = z.enum(signalIds);

/** The shape every refusal here takes. `monitors.ts` and `connections.ts` too. */
const problemSchema = z.object({ message: z.string() });

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  product: z.string(),
  idealCustomer: z.string(),
  problem: z.string(),
  signals: z.array(signal),
  /** How many monitors were made from it. Grouping, not ownership. */
  monitorCount: z.number(),
  /**
   * How many matches those monitors hold. BUG-030.
   *
   * Deleting a project takes its monitors and every match they found, and a
   * card that says "Delete Acme QA?" does not say that. This is the number
   * the confirmation names.
   */
  matchCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const answers = {
  name: z.string().min(1).max(120),
  product: z.string().min(1).max(2000),
  idealCustomer: z.string().min(1).max(2000),
  problem: z.string().min(1).max(2000),
  /**
   * Optional, because the project form stopped asking. A project made there
   * carries none and the monitor form asks instead; a project made before,
   * or by another caller, keeps what it sent. Absent is not the same as
   * empty on `PATCH`, which is what `updateBody` below is careful about.
   */
  signals: z.array(signal).optional(),
};

const createBody = z.object(answers);

/**
 * Every field optional and nothing defaulted.
 *
 * `.partial()` rather than a second object literal, so a field added above
 * cannot be forgotten here — which is how a `PATCH` starts quietly dropping it.
 */
const updateBody = createBody.partial();

function serialise(project: Awaited<ReturnType<typeof createProject>>, matchCount = 0) {
  return {
    ...project,
    signals: [...project.signals],
    matchCount,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

/**
 * Matches per project, for this person's monitors only. BUG-030.
 *
 * One grouped read for the whole list rather than one per card, and scoped on
 * `monitors.user_id` rather than on the project, so a monitor that another
 * account somehow filed under this project id counts for nobody here.
 */
async function matchCountsByProject(
  db: Database,
  userId: string,
  projectIds: readonly string[],
): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();

  const rows = await db
    .select({
      projectId: monitors.projectId,
      count: sql<number>`count(${matches.id})::int`,
    })
    .from(monitors)
    .leftJoin(matches, eq(matches.monitorId, monitors.id))
    .where(and(eq(monitors.userId, userId), inArray(monitors.projectId, [...projectIds])))
    .groupBy(monitors.projectId);

  return new Map(rows.map((row) => [row.projectId as string, row.count]));
}

/**
 * A document, named one of two ways, and never both.
 *
 * The file half arrives as text rather than as multipart: the browser reads
 * what somebody picked and posts its contents, which keeps this route to one
 * shape and adds no upload plugin. It also means the only thing that ever
 * reaches the server is the text — no filename to sanitise, no temp file.
 */
const describeBody = z
  .object({
    url: z.string().max(2000).optional(),
    text: z.string().max(2_000_000).optional(),
    contentType: z.string().max(120).optional(),
    filename: z.string().max(200).optional(),
  })
  .refine((body) => (body.url === undefined) !== (body.text === undefined), {
    message: "Give a URL or a document, not both.",
  });

const draftSchema = z.object({
  name: z.string(),
  product: z.string(),
  idealCustomer: z.string(),
  problem: z.string(),
  signals: z.array(signal),
  /** What the document did not say. Shown beside the fields, not hidden. */
  missing: z.array(z.string()),
  /** How much was read, so the screen can say a long page was cut. */
  charactersRead: z.number(),
  truncated: z.boolean(),
});

export async function registerProjectRoutes(
  app: ApiServer,
  { db, describer, describerFor }: ProjectRoutesOptions,
): Promise<void> {
  /**
   * Draft the four answers from a URL or an uploaded document.
   *
   * Four different refusals, because a person's next action differs: a URL we
   * will not fetch, a page that would not answer, a document with no words in
   * it, and a model that refused or broke. "Could not analyse" is none of
   * them.
   */
  app.route({
    method: "POST",
    url: "/api/projects/describe",
    schema: {
      body: describeBody,
      response: {
        200: draftSchema,
        400: problemSchema,
        // A model that refused is not a model that broke: 422 says the
        // document was the problem, 502 says the provider was.
        422: problemSchema,
        502: problemSchema,
        503: problemSchema,
      },
    },
    handler: async (request, reply) => {
      const model =
        describer === undefined
          ? ((await describerFor?.(sessionUserId(request))) ?? null)
          : describer;

      if (!model) {
        return reply
          .code(503)
          .send({ message: "This instance has no model key, so it cannot read a document." });
      }

      const { url, text, contentType, filename } = request.body;

      const document = url
        ? await fetchDocument(url)
        : readUploadedDocument(text ?? "", contentType ?? "text/plain");

      if (!document.ok) {
        // The reader's own sentence, which names the host, the status or the
        // type. A route that replaced it would throw away the actionable part.
        return reply.code(400).send({ message: document.failure.message });
      }

      /**
       * A blank document is refused here, before the model.
       *
       * `describeProject` refuses one too, for any other caller. This check is
       * the route's own because it is the one that decides whether a request
       * costs anything: paying a provider to be told a blank file is blank
       * would be paying for our own missing check.
       */
      if (document.text.trim() === "") {
        return reply
          .code(400)
          .send({ message: "That document has no text in it, so there was nothing to read." });
      }

      const result = await model.describe(document.text, url ?? filename);

      if (result.status === "empty") {
        return reply
          .code(400)
          .send({ message: "That document has no text in it, so there was nothing to read." });
      }

      await recordModelCall(db, {
        purpose: "project_analysis",
        outcome: result.status === "ok" ? "scored" : result.status,
        call: result.call,
        userId: sessionUserId(request),
        // No monitor and no version: this runs before either exists.
        monitorId: null,
        monitorVersion: null,
        ...(result.status === "ok" ? {} : { error: result.error }),
      });

      if (result.status === "rejected") {
        return reply.code(422).send({ message: result.error });
      }

      if (result.status !== "ok") {
        return reply.code(502).send({ message: result.error });
      }

      return {
        ...result.object,
        charactersRead: Math.min(document.text.length, maximumDocumentCharacters),
        truncated: document.truncated || document.text.length > maximumDocumentCharacters,
      };
    },
  });

  app.route({
    method: "GET",
    url: "/api/projects",
    schema: { response: { 200: z.object({ projects: z.array(projectSchema) }) } },
    handler: async (request) => {
      const userId = sessionUserId(request);
      const found = await listProjects(db, userId);
      const counts = await matchCountsByProject(
        db,
        userId,
        found.map((project) => project.id),
      );
      return { projects: found.map((project) => serialise(project, counts.get(project.id) ?? 0)) };
    },
  });

  app.route({
    method: "POST",
    url: "/api/projects",
    schema: { body: createBody, response: { 201: projectSchema } },
    handler: async (request, reply) => {
      const project = await createProject(db, sessionUserId(request), request.body);
      reply.code(201);
      return serialise(project);
    },
  });

  app.route({
    method: "GET",
    url: "/api/projects/:id",
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: projectSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const userId = sessionUserId(request);
      const project = await getProject(db, userId, request.params.id);

      if (!project) return reply.code(404).send({ message: "No such project." });

      const counts = await matchCountsByProject(db, userId, [project.id]);
      return serialise(project, counts.get(project.id) ?? 0);
    },
  });

  app.route({
    method: "PATCH",
    url: "/api/projects/:id",
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: updateBody,
      response: { 200: projectSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const userId = sessionUserId(request);
      const project = await updateProject(db, userId, request.params.id, request.body);

      if (!project) return reply.code(404).send({ message: "No such project." });

      const counts = await matchCountsByProject(db, userId, [project.id]);
      return serialise(project, counts.get(project.id) ?? 0);
    },
  });

  app.route({
    method: "DELETE",
    url: "/api/projects/:id",
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 204: z.null(), 404: problemSchema },
    },
    /**
     * The project, and the monitors made from it. BUG-030.
     *
     * They used to stay, unfiled, which was right when a monitor was made
     * separately and a project was a set of answers it copied. US-045 made the
     * inbox project-scoped, so an unfiled monitor has no inbox that reaches
     * it, no screen that lists it, and it keeps polling on the person's own
     * keys until somebody finds it in the database.
     *
     * One transaction, monitors first. A project deleted on its own would
     * leave them unfiled *and* unreachable by this read, which is the state
     * this exists to end; a monitor delete that half-finished would leave a
     * project claiming monitors it no longer has. The monitors' own rows —
     * polls, stages, matches, verdicts, continuations — go by the schema's
     * cascades, the same way `DELETE /api/monitors/:id` takes them.
     *
     * Both deletes carry `user_id`. The project's is the ownership check;
     * the monitors' is BUG-009's rule that a scope is written on every read
     * and write rather than inherited from the one above it.
     */
    handler: async (request, reply) => {
      const userId = sessionUserId(request);

      const gone = await db.transaction(async (tx) => {
        await tx
          .delete(monitors)
          .where(and(eq(monitors.userId, userId), eq(monitors.projectId, request.params.id)));

        const deleted = await tx
          .delete(projects)
          .where(and(eq(projects.id, request.params.id), eq(projects.userId, userId)))
          .returning({ id: projects.id });

        return deleted.length > 0;
      });

      if (!gone) return reply.code(404).send({ message: "No such project." });

      return reply.code(204).send(null);
    },
  });
}
