/**
 * Reading forum pages: one parser per forum program and version. US-469.
 *
 * A page names the parser that reads it. A page no parser knows is not
 * guessed at: the caller reports it, and that program's parser is the next
 * one to build.
 */
import { bbpress } from "./bbpress.js";
import { discourse } from "./discourse.js";
import { advertisedFeeds } from "./feeds.js";
import { invision4 } from "./invision4.js";
import { invision5 } from "./invision5.js";
import { mybb } from "./mybb.js";
import { phpbb3 } from "./phpbb3.js";
import { smf2 } from "./smf2.js";
import type { ForumProgram, ForumStream } from "./types.js";
import { vbulletin4 } from "./vbulletin4.js";
import { vbulletin5 } from "./vbulletin5.js";
import { xenforo1 } from "./xenforo1.js";
import { xenforo2 } from "./xenforo2.js";

export { type FeedItem, isReply, readFeed } from "./feeds.js";
export type {
  ForumProgram,
  ForumStream,
  ForumThread,
  ForumThreadSummary,
} from "./types.js";

/** Every program read so far, most used first. */
export const forumPrograms: readonly ForumProgram[] = [
  xenforo2,
  xenforo1,
  phpbb3,
  discourse,
  vbulletin5,
  vbulletin4,
  smf2,
  bbpress,
  mybb,
  invision4,
  invision5,
];

/** The parser for this page, or null when no parser knows it. */
export function detectForum(html: string): ForumProgram | null {
  return forumPrograms.find((program) => program.detect(html)) ?? null;
}

/**
 * The parser for a forum's home page, or null. A list or a thread page names
 * its program too, so `detect` is asked first. US-473.
 */
export function detectForumIndex(html: string): ForumProgram | null {
  return (
    forumPrograms.find((program) => program.detect(html) || program.detectIndex?.(html)) ?? null
  );
}

/**
 * The program whose activity stream this page is, with what it read. The
 * stream holds new topics among replies, which `detectForum` cannot tell
 * apart from a thread page. US-485.
 */
export function readForumStream(
  page: string,
  pageUrl: string,
): { program: ForumProgram; stream: ForumStream } | null {
  for (const program of forumPrograms) {
    const stream = program.readStream?.(page, pageUrl);
    if (stream) return { program, stream };
  }
  return null;
}

/** A host without its `www.`, so `www.f.example` and `f.example` are one site. */
const siteOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/**
 * A forum's program and its newest-threads feed, from its home page. A page no
 * program knows still gives a feed, unless the only feed it names is comments
 * or on another host: forums.finewoodworking.com names the magazine's
 * www.finewoodworking.com feed, articles and no threads. US-478.
 */
export function forumFeedFrom(
  html: string,
  homeUrl: string,
): { program: ForumProgram | null; feedUrl: string | null } | null {
  const program = detectForumIndex(html);
  if (program) return { program, feedUrl: program.feedUrl?.(html, homeUrl) ?? null };
  const feedUrl =
    advertisedFeeds(html, homeUrl).find(
      (url) => !/comments/i.test(new URL(url).pathname) && siteOf(url) === siteOf(homeUrl),
    ) ?? null;
  return feedUrl ? { program: null, feedUrl } : null;
}

/** The program whose feed this address is, or null. */
export function feedProgramFor(url: string): ForumProgram | null {
  return forumPrograms.find((program) => program.isFeed?.(url)) ?? null;
}
