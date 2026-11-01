/**
 * Discourse, read through its public JSON. US-469.
 *
 * Every Discourse page has a JSON twin that needs no key, so nothing here
 * reads HTML except to detect the program, by its `generator` meta tag. A
 * section's newest topics are `<category>/l/latest.json?order=created`; a
 * topic is `/t/<id>.json`, whose first post is `post_stream.posts[0]`.
 */
import { unwrapped } from "./feeds.js";
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
    // A browser shows JSON inside its own text view.
    return JSON.parse(unwrapped(page)) as unknown;
  } catch {
    return null;
  }
}

const topicUrl = (root: string, topic: { id: number; slug: string }) =>
  `${root}/t/${encodeURIComponent(topic.slug)}/${topic.id}`;

/**
 * The forum's own address from one of its pages' addresses: a forum may live
 * in a folder (`/community`) of a site whose root is something else. BUG-482.
 */
function forumRoot(pageUrl: string): string {
  const url = new URL(pageUrl);
  return url.origin + url.pathname.replace(/\/(?:latest\.json|c\/|t\/).*$|\/+$/, "");
}

export const discourse: ForumProgram = {
  id: "discourse",
  displayName: "Discourse",

  detect(page) {
    if (/<meta name="generator" content="Discourse/.test(page)) return true;
    if (!unwrapped(page).trimStart().startsWith("{")) return false;
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
    return id ? `${forumRoot(threadUrl)}/t/${id}.json` : threadUrl;
  },

  listThreads(page, pageUrl) {
    const topics =
      (parse(page) as { topic_list?: { topics?: Topic[] } } | null)?.topic_list?.topics ?? [];
    const root = forumRoot(pageUrl);
    return topics.map(
      (topic): ForumThreadSummary => ({
        id: String(topic.id),
        url: topicUrl(root, topic),
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
      url: topicUrl(forumRoot(pageUrl), json),
      title: json.title,
      text: textOf(first.cooked),
      postedAt: fromIso(first.created_at),
      approximatePostedAt: false,
    };
  },

  // Its newest topics as JSON, which `listThreads` reads, under the address
  // the page names in `data-base-url`, folder and host included: the address
  // asked for may have redirected to the forum's own host. BUG-482.
  feedUrl: (page, homeUrl) => {
    const named = page.match(/data-base-url="(https?:\/\/[^"]+)"/)?.[1];
    return `${(named ?? forumRoot(homeUrl)).replace(/\/+$/, "")}/latest.json?order=created`;
  },
};
