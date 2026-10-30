/**
 * What a forum parser reads from a page, whatever program wrote it. US-469.
 */

/** One thread on a "newest threads" list. */
export interface ForumThreadSummary {
  /** The forum's own thread id: a number in every program read so far. */
  readonly id: string;
  /** Absolute, without the forum's session id. */
  readonly url: string;
  readonly title: string;
  /** When the thread was started. Null when the list does not say. */
  readonly startedAt: Date | null;
  /** When its newest post was written. Null when the list does not say. */
  readonly lastActivityAt: Date | null;
  /** Pinned, sticky or an announcement: kept at the top whatever its age. */
  readonly pinned: boolean;
}

/** One thread's opening post. */
export interface ForumThread {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  /** The first post's text, tags removed. */
  readonly text: string;
  readonly postedAt: Date | null;
}

/** One program, at one version, that this module can read. */
export interface ForumProgram {
  /** Stable, with the version: `xenforo1`, `phpbb3`. */
  readonly id: string;
  readonly displayName: string;
  /** True when this page was written by this program and version. */
  detect(html: string): boolean;
  /** A section's address, asked for its newest threads first. */
  newestThreadsUrl(sectionUrl: string): string;
  listThreads(html: string, pageUrl: string): ForumThreadSummary[];
  /** Null when the page holds no thread this parser can read. */
  readThread(html: string, pageUrl: string): ForumThread | null;
}
