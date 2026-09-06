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
  getProject,
  listProjects,
  signals as signalIds,
  singleUserId,
  updateProject,
} from "@intentwatch/core";
import { z } from "zod";
import type { ApiServer } from "./server.js";

export interface ProjectRoutesOptions {
  readonly db: Database;
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
  signals: z.array(signal),
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

export async function registerProjectRoutes(
  app: ApiServer,
  { db }: ProjectRoutesOptions,
): Promise<void> {
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
