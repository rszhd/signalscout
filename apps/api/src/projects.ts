/**
 * The HTTP side of a project. US-045.
 *
 * A route is a shape check and a status code. Every rule lives in
 * `@intentwatch/core`, for the reason `monitors.ts` gives: the worker reads the
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
  deleteProject,
  fetchDocument,
  getProject,
  listProjects,
  maximumDocumentCharacters,
  type ProjectDescriber,
  readUploadedDocument,
  recordModelCall,
  signals as signalIds,
  singleUserId,
  updateProject,
} from "@intentwatch/core";
import { z } from "zod";
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

function serialise(project: Awaited<ReturnType<typeof createProject>>) {
  return {
    ...project,
    signals: [...project.signals],
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
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
  { db, describer = null }: ProjectRoutesOptions,
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
      if (!describer) {
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

      const result = await describer.describe(document.text, url ?? filename);

      if (result.status === "empty") {
        return reply
          .code(400)
          .send({ message: "That document has no text in it, so there was nothing to read." });
      }

      await recordModelCall(db, {
        purpose: "project_analysis",
        outcome: result.status === "ok" ? "scored" : result.status,
        call: result.call,
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
    handler: async () => {
      const found = await listProjects(db, singleUserId);
      return { projects: found.map(serialise) };
    },
  });

  app.route({
    method: "POST",
    url: "/api/projects",
    schema: { body: createBody, response: { 201: projectSchema } },
    handler: async (request, reply) => {
      const project = await createProject(db, singleUserId, request.body);
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
      const project = await getProject(db, singleUserId, request.params.id);

      if (!project) return reply.code(404).send({ message: "No such project." });

      return serialise(project);
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
      const project = await updateProject(db, singleUserId, request.params.id, request.body);

      if (!project) return reply.code(404).send({ message: "No such project." });

      return serialise(project);
    },
  });

  app.route({
    method: "DELETE",
    url: "/api/projects/:id",
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 204: z.null(), 404: problemSchema },
    },
    handler: async (request, reply) => {
      const gone = await deleteProject(db, singleUserId, request.params.id);

      if (!gone) return reply.code(404).send({ message: "No such project." });

      // The monitors made from it stay, unfiled. Their answers are their own.
      return reply.code(204).send(null);
    },
  });
}
