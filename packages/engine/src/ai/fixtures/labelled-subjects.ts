/**
 * The fifty items every triage and scoring measurement runs on, in one place.
 *
 * US-029 labelled 46 real comments across two Reddit threads — asking,
 * answering or neither — and PLAN.md carries four worked example posts. Two
 * instruments read them: `capture-triage.ts` asks the cheap model whether to
 * keep each one, and `capture-scores.ts` asks the classifier what each one is
 * worth. The comparison between those two answers is the whole question US-222
 * exists for, and it only means something while both read the same items in
 * the same order.
 *
 * **Each subject carries both shapes of the same item.** `forTriage` is what
 * the first reader sees: source, channel, the post's title and the text.
 * `forClassification` is what the second reader sees, which is wider — a date,
 * an author, and the thread above a comment. Building both here is what stops
 * a later edit giving one reader a field the other silently lacks, and then
 * reading the difference as a disagreement between the models.
 *
 * The thread context is built the way `worker/classify.ts` builds it in
 * production: the parent post's title and body, the reply directly above when
 * there is one, each cut to 600 characters.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PostForClassification } from "../prompt.js";
import type { ItemForTriage } from "../triage-prompt.js";
import { labelledExamples } from "./examples.js";

const threadsAt = fileURLToPath(new URL("../../sources/deletion-fixtures/", import.meta.url));

/** `worker/classify.ts` cuts a parent to this, and so does this file. */
const parentExcerptLength = 600;

/** The two threads US-029 captured and labelled, in the order it measured them. */
const threads = [
  {
    name: "question-post",
    thread: "scrapecreators-comments-canonical.json",
    labels: "comment-labels.json",
  },
  {
    name: "statement-post",
    thread: "scrapecreators-comments-statement-post.json",
    labels: "comment-labels-statement-post.json",
  },
] as const;

interface CapturedComment {
  readonly id: string;
  readonly author?: string;
  readonly body?: string;
  readonly created_utc?: number;
  readonly replies?: { readonly items?: readonly CapturedComment[] };
}

interface CapturedPost {
  readonly title: string;
  readonly subreddit: string;
  readonly selftext?: string;
  readonly created_utc?: number;
}

export interface HandLabel {
  readonly id: string;
  readonly role: "asking" | "answering" | "neither";
  readonly topical: boolean;
}

export interface LabelledSubject {
  readonly kind: "comment" | "post";
  readonly thread: string;
  readonly id: string;
  /** The hand label, where there is one. A post has none. */
  readonly role: HandLabel["role"] | null;
  readonly forTriage: ItemForTriage;
  readonly forClassification: PostForClassification;
}

/** A comment with the one directly above it, which the classifier is shown. */
function flatten(
  comments: readonly CapturedComment[],
  above?: CapturedComment,
): { comment: CapturedComment; above?: CapturedComment }[] {
  return comments.flatMap((comment) => [
    { comment, ...(above ? { above } : {}) },
    ...flatten(comment.replies?.items ?? [], comment),
  ]);
}

function secondsToDate(seconds: number | undefined): Date {
  return new Date((seconds ?? 0) * 1000);
}

export function labelledSubjects(): LabelledSubject[] {
  const subjects: LabelledSubject[] = [];

  for (const source of threads) {
    const thread = JSON.parse(readFileSync(`${threadsAt}${source.thread}`, "utf8")) as {
      post: CapturedPost;
      comments: readonly CapturedComment[];
    };
    const hand = JSON.parse(readFileSync(`${threadsAt}${source.labels}`, "utf8")) as {
      labels: readonly HandLabel[];
    };
    const labelOf = new Map(hand.labels.map((label) => [label.id, label]));

    for (const { comment, above } of flatten(thread.comments)) {
      const label = labelOf.get(comment.id);
      if (!label) throw new Error(`${source.labels} has no label for ${comment.id}.`);

      const excerpt = comment.body ?? "";

      subjects.push({
        kind: "comment",
        thread: source.name,
        id: comment.id,
        role: label.role,
        forTriage: {
          source: "reddit",
          channel: thread.post.subreddit,
          // The parent post's title, because a comment borrows its subject from
          // the post above it. US-020 stores this; here it is read from the
          // fixture so the prompt sees what production will send.
          title: thread.post.title,
          excerpt,
        },
        forClassification: {
          source: "reddit",
          channel: thread.post.subreddit,
          author: comment.author ?? null,
          title: null,
          excerpt,
          postedAt: secondsToDate(comment.created_utc),
          thread: {
            postTitle: thread.post.title,
            postExcerpt: (thread.post.selftext ?? "").slice(0, parentExcerptLength),
            ...(above
              ? { parentReplyExcerpt: (above.body ?? "").slice(0, parentExcerptLength) }
              : {}),
          },
        },
      });
    }
  }

  for (const example of labelledExamples) {
    subjects.push({
      kind: "post",
      thread: "plan-examples",
      id: example.slug,
      role: null,
      forTriage: {
        source: example.post.source,
        channel: example.post.channel,
        title: example.post.title,
        excerpt: example.post.excerpt,
      },
      forClassification: example.post,
    });
  }

  return subjects;
}
