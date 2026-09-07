/**
 * The reply instructions a person has saved, and the reads and writes for them.
 *
 * US-040. **Owned by the account, not by a project**, because a voice is how
 * one person writes and the same instruction serves every project they run. A
 * copy per project would be the same words typed twice, drifting apart from
 * the moment one is edited.
 *
 * Several rather than one, because a person replies differently in different
 * rooms. The choice belongs at the moment of drafting, which is why the draft
 * route takes a prompt id rather than reading a setting.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { replyPrompts } from "../db/schema.js";

export interface ReplyPrompt {
  readonly id: string;
  readonly name: string;
  readonly instruction: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateReplyPromptInput {
  readonly name: string;
  readonly instruction: string;
}

/**
 * Every field optional, and absent means "leave it".
 *
 * The rule US-022 had to fix on monitors and US-045 repeated on projects: a
 * `PATCH` carrying one field must not erase the rest, and a body schema that
 * fills absent keys with defaults is how that happens.
 */
export interface UpdateReplyPromptInput {
  readonly name?: string;
  readonly instruction?: string;
}

/** Thrown when a name is already taken, so a route can answer 409. */
export class DuplicateReplyPromptName extends Error {
  /** The name that was taken. Not `name`: `Error` already owns that. */
  readonly promptName: string;

  constructor(promptName: string) {
    super(`You already have a prompt called "${promptName}".`);
    this.name = "DuplicateReplyPromptName";
    this.promptName = promptName;
  }
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`A reply prompt needs a ${field}.`);
  return trimmed;
}

/**
 * Postgres says 23505 when a unique index refuses a row.
 *
 * The cause as well as the error itself: drizzle wraps the driver's error, so
 * the code sits one level down. Checking only the top level made a duplicate
 * name answer 500 instead of 409 — a bug the route's own test caught.
 */
function isUniqueViolation(error: unknown): boolean {
  const codeOf = (value: unknown): unknown => (value as { code?: unknown })?.code;

  return codeOf(error) === "23505" || codeOf((error as { cause?: unknown })?.cause) === "23505";
}

export async function listReplyPrompts(db: Database, userId: string): Promise<ReplyPrompt[]> {
  return await db
    .select({
      id: replyPrompts.id,
      name: replyPrompts.name,
      instruction: replyPrompts.instruction,
      createdAt: replyPrompts.createdAt,
      updatedAt: replyPrompts.updatedAt,
    })
    .from(replyPrompts)
    .where(eq(replyPrompts.userId, userId))
    // By name, because this list is a thing a person chooses from rather than
    // a history. Ordered case-insensitively for the same reason the unique
    // index is: "Short" and "short" belong next to each other.
    .orderBy(asc(sql`lower(${replyPrompts.name})`));
}

export async function createReplyPrompt(
  db: Database,
  userId: string,
  input: CreateReplyPromptInput,
): Promise<ReplyPrompt> {
  const name = required(input.name, "name");

  try {
    const [row] = await db
      .insert(replyPrompts)
      .values({
        userId,
        name,
        instruction: required(input.instruction, "instruction"),
      })
      .returning({
        id: replyPrompts.id,
        name: replyPrompts.name,
        instruction: replyPrompts.instruction,
        createdAt: replyPrompts.createdAt,
        updatedAt: replyPrompts.updatedAt,
      });

    if (!row) throw new Error("The reply prompt was not created.");
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateReplyPromptName(name);
    throw error;
  }
}

export async function updateReplyPrompt(
  db: Database,
  userId: string,
  id: string,
  input: UpdateReplyPromptInput,
): Promise<ReplyPrompt | null> {
  const name = input.name === undefined ? undefined : required(input.name, "name");

  try {
    const [row] = await db
      .update(replyPrompts)
      .set({
        ...(name === undefined ? {} : { name }),
        ...(input.instruction === undefined
          ? {}
          : { instruction: required(input.instruction, "instruction") }),
        updatedAt: new Date(),
      })
      .where(and(eq(replyPrompts.id, id), eq(replyPrompts.userId, userId)))
      .returning({
        id: replyPrompts.id,
        name: replyPrompts.name,
        instruction: replyPrompts.instruction,
        createdAt: replyPrompts.createdAt,
        updatedAt: replyPrompts.updatedAt,
      });

    return row ?? null;
  } catch (error) {
    if (isUniqueViolation(error) && name) throw new DuplicateReplyPromptName(name);
    throw error;
  }
}

/** Whether a row went, so a route can answer 404 rather than pretending. */
export async function deleteReplyPrompt(
  db: Database,
  userId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(replyPrompts)
    .where(and(eq(replyPrompts.id, id), eq(replyPrompts.userId, userId)))
    .returning({ id: replyPrompts.id });

  return rows.length > 0;
}
