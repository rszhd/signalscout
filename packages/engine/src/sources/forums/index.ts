/**
 * Reading forum pages: one parser per forum program and version. US-469.
 *
 * A page names the parser that reads it. A page no parser knows is not
 * guessed at: the caller reports it, and that program's parser is the next
 * one to build.
 */
import { discourse } from "./discourse.js";
import { phpbb3 } from "./phpbb3.js";
import type { ForumProgram } from "./types.js";
import { xenforo1 } from "./xenforo1.js";

export type { ForumProgram, ForumThread, ForumThreadSummary } from "./types.js";

/** Every program read so far, most used first. */
export const forumPrograms: readonly ForumProgram[] = [xenforo1, phpbb3, discourse];

/** The parser for this page, or null when no parser knows it. */
export function detectForum(html: string): ForumProgram | null {
  return forumPrograms.find((program) => program.detect(html)) ?? null;
}
