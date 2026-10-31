/**
 * Discourse, read through its public JSON. US-469.
 *
 * Every Discourse page has a JSON twin that needs no key, so nothing here
 * reads HTML except to detect the program, by its `generator` meta tag. A
 * section's newest topics are `<category>/l/latest.json?order=created`; a
 * topic is `/t/<id>.json`, whose first post is `post_stream.posts[0]`.
 */
import { fromIso, textOf } from "./html.js";
import type { ForumProgram, ForumThreadSummary } from "./types.js";

interface Topic {
  id: number;
  slug: string;
  title: string;
  created_at: string;
  last_posted_at?: string | null;
  bumped_at?: string | null;
  pinned?: boolean;
  pinned_globally?: boolean;
}

interface Post {
  post_number: number;
  created_at: string;
  cooked: string;
}

function parse(page: string): unknown {
  try {
    return JSON.parse(page) as unknown;
  } catch {
    return null;
  }
}

const topicUrl = (origin: string, topic: { id: number; slug: string }) =>
  `${origin}/t/${encodeURIComponent(topic.slug)}/${topic.id}`;

export const discourse: ForumProgram = {
  id: "discourse",
  displayName: "Discourse",

  detect(page) {
    if (/<meta name="generator" content="Discourse/.test(page)) return true;
    if (!page.trimStart().startsWith("{")) return false;
    const json = parse(page) as { topic_list?: unknown; post_stream?: unknown } | null;
    return Boolean(json && (json.topic_list || json.post_stream));
  },

  newestThreadsUrl(sectionUrl) {
    const url = new URL(sectionUrl);
    const path = url.pathname.replace(/\/+$/, "");
    url.pathname = path === "" ? "/latest.json" : `${path}/l/latest.json`;
    url.search = "?order=created";
    return url.toString();
  },

  threadPageUrl(threadUrl) {
    const url = new URL(threadUrl);
    const id = url.pathname.match(/\/t\/(?:[^/]+\/)?(\d+)/)?.[1];
    return id ? `${url.origin}/t/${id}.json` : threadUrl;
  },

  listThreads(page, pageUrl) {
    const topics =
      (parse(page) as { topic_list?: { topics?: Topic[] } } | null)?.topic_list?.topics ?? [];
    const { origin } = new URL(pageUrl);
    return topics.map(
      (topic): ForumThreadSummary => ({
        id: String(topic.id),
        url: topicUrl(origin, topic),
        title: topic.title,
        startedAt: fromIso(topic.created_at),
        approximateStart: false,
        lastActivityAt: fromIso(topic.last_posted_at ?? topic.bumped_at ?? undefined),
        pinned: Boolean(topic.pinned || topic.pinned_globally),
      }),
    );
  },

  readThread(page, pageUrl) {
    const json = parse(page) as (Topic & { post_stream?: { posts?: Post[] } }) | null;
    const first = json?.post_stream?.posts?.find((post) => post.post_number === 1);
    if (!json?.id || !first) return null;
    return {
      id: String(json.id),
      url: topicUrl(new URL(pageUrl).origin, json),
      title: json.title,
      text: textOf(first.cooked),
      postedAt: fromIso(first.created_at),
      approximatePostedAt: false,
    };
  },

  // Its newest topics as JSON, which `listThreads` reads: a section at the root.
  feedUrl: (_page, homeUrl) => new URL("/latest.json?order=created", homeUrl).toString(),
};
