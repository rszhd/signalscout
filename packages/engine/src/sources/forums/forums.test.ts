import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bbpress } from "./bbpress.js";
import { discourse } from "./discourse.js";
import { forumFolder } from "./feeds.js";
import { decodeEntities, fromAgo, fromEnglishDate, textOf, withParameters } from "./html.js";
import {
  detectForum,
  detectForumIndex,
  feedProgramFor,
  forumFeedFrom,
  forumPrograms,
  isReply,
  readFeed,
} from "./index.js";
import { invision4 } from "./invision4.js";
import { mybb } from "./mybb.js";
import { phpbb3 } from "./phpbb3.js";
import { smf2 } from "./smf2.js";
import { vbulletin4 } from "./vbulletin4.js";
import { vbulletin5 } from "./vbulletin5.js";
import { xenforo1 } from "./xenforo1.js";
import { xenforo2 } from "./xenforo2.js";

const manifest = JSON.parse(
  readFileSync(new URL("./fixtures/manifest.json", import.meta.url), "utf8"),
) as Record<string, { url: string; capturedAt: string }>;
function page(name: string): { html: string; url: string } {
  const file = [`${name}.html`, `${name}.json`].find((candidate) => manifest[candidate]);
  const entry = file ? manifest[file] : undefined;
  if (!file || !entry) throw new Error(`no capture named ${name}`);
  return {
    html: readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8"),
    url: entry.url,
  };
}

const xenforoListUrl = manifest["xenforo2-list.html"]?.url ?? "";

describe("which parser reads a page", () => {
  it("names the program and version of each captured page", () => {
    for (const program of forumPrograms) {
      expect(detectForum(page(`${program.id}-list`).html)?.id).toBe(program.id);
      expect(detectForum(page(`${program.id}-thread`).html)?.id).toBe(program.id);
    }
  });

  it("says unknown rather than guessing", () => {
    expect(detectForum("<html><body><a href='/topic/1'>Hello</a></body></html>")).toBeNull();
  });

  it("is never two parsers at once", () => {
    for (const program of forumPrograms) {
      const html = page(`${program.id}-list`).html;
      expect(forumPrograms.filter((other) => other.detect(html)).map((other) => other.id)).toEqual([
        program.id,
      ]);
    }
  });
});

describe("XenForo 1", () => {
  const list = page("xenforo1-list");
  const threads = xenforo1.listThreads(list.html, list.url);

  it("reads every thread on the list, with both of its times", () => {
    expect(threads).toHaveLength(50);
    expect(threads.every((thread) => thread.startedAt && thread.lastActivityAt)).toBe(true);
    expect(threads[0]).toEqual({
      id: "2885650",
      url: "https://forums.digitalpoint.com/threads/hiring-malaysia-based-writer-for-igaming-payment-guides-screenshots.2885650/",
      title: "Hiring Malaysia-Based Writer for iGaming Payment Guides & Screenshots",
      startedAt: new Date("2026-10-27T13:35:10.000Z"),
      approximateStart: false,
      lastActivityAt: new Date("2026-10-27T13:35:10.000Z"),
      pinned: false,
    });
  });

  it("reads an older time from its words, with or without the hour", () => {
    // Shown as "Mar 3, 2011": no data-time, no hour.
    const old = threads.find((thread) => thread.id === "2110506");
    expect(old?.startedAt).toEqual(new Date("2011-03-03T00:00:00.000Z"));
    expect(old?.approximateStart).toBe(true);
  });

  it("reads the first post of a thread, without the prefix label", () => {
    const thread = page("xenforo1-thread");
    const read = xenforo1.readThread(thread.html, thread.url);
    expect(read).toMatchObject({
      id: "2885650",
      title: "Hiring Malaysia-Based Writer for iGaming Payment Guides & Screenshots",
      postedAt: new Date("2026-10-27T13:35:10.000Z"),
    });
    expect(read?.text.startsWith("I'm looking for a Malaysia-based writer")).toBe(true);
    expect(read?.text).toContain("Familiar with GrabPay");
    expect(read?.text).not.toMatch(/<|&#039;/);
  });

  it("asks a section for its threads by start time", () => {
    expect(xenforo1.newestThreadsUrl("https://forums.example.com/forums/watches.12/")).toBe(
      "https://forums.example.com/forums/watches.12/?order=post_date&direction=desc",
    );
  });
});

describe("XenForo 2", () => {
  const list = page("xenforo2-list");
  const threads = xenforo2.listThreads(list.html, list.url);

  it("reads every thread with exact times, and marks the pinned ones by their icon", () => {
    expect(threads).toHaveLength(54);
    expect(threads.filter((thread) => thread.pinned)).toHaveLength(4);
    expect(
      threads.every(
        (thread) => thread.startedAt && thread.lastActivityAt && !thread.approximateStart,
      ),
    ).toBe(true);
    expect(threads.find((thread) => !thread.pinned)).toEqual({
      id: "2493064",
      url: "https://forums.macrumors.com/threads/m6-imac.2493064/",
      title: "M6 iMac",
      startedAt: new Date("2026-10-28T18:05:14.000Z"),
      approximateStart: false,
      lastActivityAt: new Date("2026-10-30T00:36:35.000Z"),
      pinned: false,
    });
  });

  it("reads the first post of a thread", () => {
    const thread = page("xenforo2-thread");
    const read = xenforo2.readThread(thread.html, thread.url);
    expect(read).toMatchObject({
      id: "2493064",
      url: "https://forums.macrumors.com/threads/m6-imac.2493064/",
      title: "M6 iMac",
      postedAt: new Date("2026-10-28T18:05:14.000Z"),
    });
    expect(read?.text.startsWith("I ordered my M6 iMac this morning")).toBe(true);
    expect(read?.text).toContain("Anyone getting a later delivery date?");
  });

  it("reads the first post in VerticalScope's California theme", () => {
    const thread = page("xenforo2-california-thread");
    const read = xenforo2.readThread(thread.html, thread.url);
    expect(read).toMatchObject({
      id: "367057",
      url: "https://www.lumberjocks.com/threads/pen-turning-problem.367057/",
      title: "Pen turning problem",
      postedAt: new Date("2026-10-31T00:45:34.000Z"),
      approximatePostedAt: false,
    });
    expect(read?.text.startsWith("Almost completed my Jr. Gentlemen's II pen")).toBe(true);
  });
});

describe("vBulletin 5", () => {
  const list = vbulletin5.listThreads(
    page("vbulletin5-list").html,
    page("vbulletin5-list").url,
    new Date("2026-10-30T04:00:00Z"),
  );

  it("reads every topic, its exact last activity, and a start in words marked approximate", () => {
    expect(list).toHaveLength(22);
    expect(list.filter((thread) => thread.pinned)).toHaveLength(2);
    expect(list.find((thread) => !thread.pinned)).toEqual({
      id: "4512751",
      url: "https://forum.vbulletin.com/forum/vbulletin-5-connect/vbulletin-5-installations/4512751-keep-getting-error",
      title: "Keep getting error",
      // "Tue 13 Oct '26, 3:46pm" in the board's zone; the thread says 23:46 UTC.
      startedAt: new Date("2026-10-13T15:46:00.000Z"),
      approximateStart: true,
      lastActivityAt: new Date("2026-10-29T20:37:58.000Z"),
      pinned: false,
    });
  });

  it("reads the first post and its exact time from the thread", () => {
    const thread = page("vbulletin5-thread");
    const read = vbulletin5.readThread(thread.html, thread.url);
    expect(read).toMatchObject({
      id: "4512751",
      title: "Keep getting error",
      postedAt: new Date("2026-10-13T23:46:55.000Z"),
    });
    expect(read?.text).toContain("Database error in vBulletin 5.7.5");
  });
});

describe("vBulletin 3/4", () => {
  const list = page("vbulletin4-list");
  const threads = vbulletin4.listThreads(list.html, list.url);

  it("reads every thread, its times in words, and the pinned one before the list", () => {
    expect(threads).toHaveLength(26);
    expect(threads.filter((thread) => thread.pinned)).toHaveLength(1);
    expect(threads.every((thread) => thread.startedAt && thread.lastActivityAt)).toBe(true);
    expect(threads.find((thread) => !thread.pinned)).toEqual({
      id: "1964520",
      url: "https://www.webhostingtalk.com/showthread.php?t=1964520",
      title: "Dedicated IP on Shared Servers",
      // "10-14-2026 05:51 AM": month first, in the board's zone.
      startedAt: new Date("2026-10-14T05:51:00.000Z"),
      approximateStart: true,
      lastActivityAt: new Date("2026-10-18T03:52:00.000Z"),
      pinned: false,
    });
  });

  it("reads the first post, and stops before the replies", () => {
    const thread = page("vbulletin4-thread");
    const read = vbulletin4.readThread(thread.html, thread.url);
    expect(read).toMatchObject({
      id: "1964520",
      title: "Dedicated IP on Shared Servers",
      postedAt: new Date("2026-10-14T05:51:00.000Z"),
      approximatePostedAt: true,
    });
    expect(read?.text.startsWith("I am using reseller hosting.")).toBe(true);
    expect(read?.text.endsWith("from other resellers on the server?")).toBe(true);
  });

  it("asks a forum for its threads by start time", () => {
    expect(vbulletin4.newestThreadsUrl("https://forum.example.com/forumdisplay.php?f=6")).toBe(
      "https://forum.example.com/forumdisplay.php?f=6&sort=dateline&order=desc",
    );
  });
});

describe("phpBB 3", () => {
  const list = page("phpbb3-list");
  const threads = phpbb3.listThreads(list.html, list.url);

  it("reads every thread on the list, and marks the pinned one", () => {
    expect(threads).toHaveLength(50);
    expect(threads.filter((thread) => thread.pinned).map((thread) => thread.id)).toEqual(["11126"]);
    expect(threads.every((thread) => thread.startedAt && thread.lastActivityAt)).toBe(true);
  });

  it("drops the session id from every address", () => {
    expect(list.html).toContain("sid=");
    expect(threads.some((thread) => /sid=/.test(thread.url))).toBe(false);
    expect(threads[1]).toEqual({
      id: "1178757",
      url: "https://forums.gentoo.org/viewtopic.php?t=1178757",
      title: "Won't boot past initramfs screen",
      startedAt: new Date("2026-10-11T16:53:57.000Z"),
      approximateStart: false,
      lastActivityAt: new Date("2026-10-29T01:12:33.000Z"),
      pinned: false,
    });
  });

  it("reads the first post of a thread, and none of the replies", () => {
    const thread = page("phpbb3-thread");
    const read = phpbb3.readThread(thread.html, thread.url);
    expect(read).toMatchObject({
      id: "1178757",
      url: "https://forums.gentoo.org/viewtopic.php?t=1178757",
      title: "Won't boot past initramfs screen",
      postedAt: new Date("2026-10-11T16:53:57.000Z"),
    });
    expect(read?.text.startsWith("I can't get past the boot screen")).toBe(true);
    expect(read?.text).not.toContain("Do you use a manually configered kernel");
  });

  it("asks a forum for its most recently active threads", () => {
    expect(phpbb3.newestThreadsUrl("https://forum.example.com/viewforum.php?f=14")).toBe(
      "https://forum.example.com/viewforum.php?f=14&sk=t&sd=d",
    );
  });
});

describe("Discourse, through its JSON", () => {
  const list = page("discourse-list");
  const threads = discourse.listThreads(list.html, list.url);

  it("is detected from a section's HTML head and from its JSON", () => {
    expect(detectForum(page("discourse-section").html)?.id).toBe("discourse");
    expect(discourse.detect(list.html)).toBe(true);
    expect(discourse.detect("{}")).toBe(false);
  });

  it("reads every topic, with both of its times", () => {
    expect(threads).toHaveLength(30);
    expect(threads.every((thread) => thread.startedAt && thread.lastActivityAt)).toBe(true);
    expect(threads[0]).toEqual({
      id: "416139",
      url: "https://meta.discourse.org/t/topic/416139",
      title: "电子邮件服务器设置可以做成随时可以修改的配置吗？",
      startedAt: new Date("2026-10-30T03:13:31.307Z"),
      approximateStart: false,
      lastActivityAt: new Date("2026-10-30T03:41:36.779Z"),
      pinned: false,
    });
  });

  it("reads the first post from the topic's JSON", () => {
    expect(discourse.threadPageUrl?.("https://meta.discourse.org/t/topic/416139")).toBe(
      "https://meta.discourse.org/t/416139.json",
    );
    const thread = page("discourse-thread");
    const read = discourse.readThread(thread.html, thread.url);
    expect(read).toMatchObject({
      id: "416139",
      url: "https://meta.discourse.org/t/topic/416139",
      postedAt: new Date("2026-10-30T03:13:31.385Z"),
    });
    expect(
      read?.text.startsWith("I recently ran into a situation where my email service provider"),
    ).toBe(true);
    expect(read?.text).not.toMatch(/<p>|<\/p>/);
  });

  it("keeps a forum's folder in its topics' addresses", () => {
    const list = page("discourse-list");
    const inFolder = "https://www.sitepoint.com/community/latest.json?order=created";
    const [first] = discourse.listThreads(list.html, inFolder);
    expect(first?.url).toMatch(/^https:\/\/www\.sitepoint\.com\/community\/t\/[^/]+\/\d+$/);
    expect(discourse.threadPageUrl?.("https://www.sitepoint.com/community/t/topic/416139")).toBe(
      "https://www.sitepoint.com/community/t/416139.json",
    );
    const thread = page("discourse-thread");
    expect(
      discourse.readThread(thread.html, "https://www.sitepoint.com/community/t/416139.json")?.url,
    ).toBe("https://www.sitepoint.com/community/t/topic/416139");
  });

  it("reads topics a browser showed as text, escaped inside a <pre>", () => {
    const list = page("discourse-list");
    const escaped = list.html
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    const shown = `<html><head><meta name="color-scheme" content="light dark"><meta charset="utf-8"></head><body><pre>${escaped}</pre></body></html>`;
    expect(discourse.detect(shown)).toBe(true);
    expect(discourse.listThreads(shown, list.url)).toEqual(
      discourse.listThreads(list.html, list.url),
    );
  });

  it("asks a category, or the whole site, for its topics by start time", () => {
    expect(discourse.newestThreadsUrl("https://meta.discourse.org/c/support/6")).toBe(
      "https://meta.discourse.org/c/support/6/l/latest.json?order=created",
    );
    expect(discourse.newestThreadsUrl("https://forum.example.com/")).toBe(
      "https://forum.example.com/latest.json?order=created",
    );
  });
});

describe("SMF 2.0", () => {
  const list = page("smf2-list");
  const threads = smf2.listThreads(list.html, list.url);

  it("reads every topic and its last post's date, and marks the pinned ones", () => {
    expect(threads).toHaveLength(50);
    expect(threads.filter((thread) => thread.pinned)).toHaveLength(14);
    expect(threads.every((thread) => thread.lastActivityAt)).toBe(true);
    // SMF 2.0 lists no start time: the thread page says it.
    expect(threads.every((thread) => thread.startedAt === null)).toBe(true);
    expect(threads.find((thread) => !thread.pinned)).toEqual({
      id: "126408",
      url: "https://geekhack.org/index.php?topic=126408.0",
      title: "Drop appears to be closing eventually - How does that impact GH?",
      startedAt: null,
      approximateStart: false,
      lastActivityAt: new Date("2026-03-16T18:18:45.000Z"),
      pinned: false,
    });
  });

  it("drops the session id SMF puts in every link", () => {
    expect(list.html).toContain("PHPSESSID=");
    expect(threads.some((thread) => /PHPSESSID/.test(thread.url))).toBe(false);
  });

  it("reads the first post and the time it was written", () => {
    const thread = page("smf2-thread");
    expect(smf2.readThread(thread.html, thread.url)).toEqual({
      id: "126408",
      url: "https://geekhack.org/index.php?topic=126408.0",
      title: "Drop appears to be closing eventually - How does that impact GH?",
      text: "As far as I know Corsair owns drop, and drops owns GeekHack. Drop appears to be closing down operations in the near future. How will that impact GH?",
      postedAt: new Date("2026-02-25T12:03:37.000Z"),
      approximatePostedAt: true,
    });
  });

  it("asks a board for its topics by first post, with SMF's semicolons", () => {
    expect(smf2.newestThreadsUrl("https://forum.example.com/index.php?board=64.0")).toBe(
      "https://forum.example.com/index.php?board=64.0;sort=first_post;desc",
    );
  });
});

describe("bbPress", () => {
  const list = page("bbpress-list");
  // "Ago" is counted from when the page was fetched.
  const captured = new Date(manifest["bbpress-list.html"]?.capturedAt ?? "");
  const threads = bbpress.listThreads(list.html, list.url, captured);

  it("reads every topic, its freshness counted back from the fetch, and the pinned ones", () => {
    expect(threads).toHaveLength(33);
    expect(threads.filter((thread) => thread.pinned)).toHaveLength(3);
    expect(threads.every((thread) => thread.lastActivityAt && thread.startedAt === null)).toBe(
      true,
    );
    expect(threads.find((thread) => !thread.pinned)).toEqual({
      id: "19058414",
      url: "https://wordpress.org/support/topic/wordpress-http-500-error-website-and-admin-login-unavailable/",
      title: "WordPress HTTP 500 Error \u2013 Website and Admin Login Unavailable",
      startedAt: null,
      approximateStart: false,
      // "15 hours, 10 minutes ago"; its title says October 29, 2026 at 3:48 pm.
      lastActivityAt: new Date("2026-10-29T15:49:17.767Z"),
      pinned: false,
    });
  });

  it("reads the first post and its exact start from the topic page", () => {
    const thread = page("bbpress-thread");
    const read = bbpress.readThread(thread.html, thread.url);
    expect(read).toMatchObject({
      id: "19058414",
      title: "WordPress HTTP 500 Error \u2013 Website and Admin Login Unavailable",
      postedAt: new Date("2026-10-29T09:16:45.000Z"),
    });
    expect(read?.text.startsWith("Hello everyone,")).toBe(true);
    expect(read?.text.endsWith("[ log in to see the link]")).toBe(true);
  });
});

describe("MyBB, in a board's own theme", () => {
  const list = page("mybb-list");
  const threads = mybb.listThreads(list.html, list.url);

  it("reads every thread, with pinned ones from the row before each title", () => {
    expect(threads).toHaveLength(20);
    expect(threads.filter((thread) => thread.pinned)).toHaveLength(5);
    expect(threads.every((thread) => thread.lastActivityAt)).toBe(true);
    expect(threads.find((thread) => !thread.pinned)).toEqual({
      id: "389074",
      url: "https://forum.kodi.tv/showthread.php?tid=389074",
      title: "Kodi playing Atmos 5.1.2 fine, but 5.1 Flac is stereo",
      // "2026-10-17, 08:57" in the board's zone.
      startedAt: new Date("2026-10-17T08:57:00.000Z"),
      approximateStart: true,
      lastActivityAt: new Date("2026-10-17T15:56:00.000Z"),
      pinned: false,
    });
  });

  it("reads the first post, with the thread id from the address", () => {
    const thread = page("mybb-thread");
    const read = mybb.readThread(thread.html, thread.url);
    expect(read).toMatchObject({
      id: "389074",
      url: "https://forum.kodi.tv/showthread.php?tid=389074",
      title: "Kodi playing Atmos 5.1.2 fine, but 5.1 Flac is stereo",
      postedAt: new Date("2026-10-17T08:57:00.000Z"),
    });
    expect(read?.text.startsWith("Kodi 21.2")).toBe(true);
    expect(read?.text.endsWith("Thanks in advance.")).toBe(true);
  });

  it("asks a forum for its threads by start time", () => {
    expect(mybb.newestThreadsUrl("https://forum.example.com/forumdisplay.php?fid=164")).toBe(
      "https://forum.example.com/forumdisplay.php?fid=164&sortby=started&order=desc",
    );
  });
});

describe("Invision Community 4", () => {
  const list = page("invision4-list");
  const threads = invision4.listThreads(list.html, list.url);

  it("reads every thread with exact times, and stops each row before the sidebar", () => {
    expect(threads).toHaveLength(25);
    expect(
      threads.every(
        (thread) => thread.startedAt && thread.lastActivityAt && !thread.approximateStart,
      ),
    ).toBe(true);
    // No thread on this page is pinned. The last row is followed by the
    // sidebar, whose "Featured" badge and times are not the row's.
    expect(threads.some((thread) => thread.pinned)).toBe(false);
    expect(threads.at(-1)).toMatchObject({
      id: "1643366",
      startedAt: new Date("2026-10-06T05:56:13.000Z"),
      lastActivityAt: new Date("2026-10-13T12:58:27.000Z"),
    });
    expect(threads[0]).toEqual({
      id: "1644011",
      url: "https://linustechtips.com/topic/1644011-pc-for-cs2/",
      title: "PC for CS2",
      startedAt: new Date("2026-10-28T10:07:35.000Z"),
      approximateStart: false,
      lastActivityAt: new Date("2026-10-29T13:54:26.000Z"),
      pinned: false,
    });
  });

  it("decodes a title's entities", () => {
    expect(threads.find((thread) => thread.id === "1643932")?.title).toBe(
      "I'm looking to build my first mini ITX rig",
    );
  });

  it("reads the first post, and nothing after its content", () => {
    const thread = page("invision4-thread");
    const read = invision4.readThread(thread.html, thread.url);
    expect(read).toMatchObject({
      id: "1644011",
      url: "https://linustechtips.com/topic/1644011-pc-for-cs2/",
      title: "PC for CS2",
      postedAt: new Date("2026-10-28T10:07:35.000Z"),
    });
    expect(read?.text.startsWith("Budget (including currency): 20 000 - 26 000 nok")).toBe(true);
    expect(read?.text).toContain("is it necessary or worth the jump in price?");
    expect(read?.text).not.toContain("Link to comment");
  });

  it("reads a section as it comes, by last activity", () => {
    expect(invision4.newestThreadsUrl("https://forum.example.com/forum/18-new-builds/")).toBe(
      "https://forum.example.com/forum/18-new-builds/",
    );
  });
});

describe("a forum's home page and its feed", () => {
  // The feed each captured home page leads to. Invision publishes none.
  const feeds: Record<string, string | null> = {
    xenforo2: "https://forums.macrumors.com/forums/-/index.rss",
    xenforo1: "https://forums.digitalpoint.com/forums/-/index.rss",
    phpbb3: "https://forums.gentoo.org/app.php/feed/topics",
    vbulletin5: "https://forum.vbulletin.com/external?type=rss2",
    vbulletin4: "https://www.webhostingtalk.com/external.php?type=RSS2",
    smf2: "https://geekhack.org/index.php?action=.xml;type=rss2;sa=news",
    bbpress: "https://wordpress.org/support/topics/feed/",
    mybb: "https://forum.kodi.tv/syndication.php",
    invision4: null,
  };

  for (const [id, feed] of Object.entries(feeds)) {
    it(`names ${id} from its home page, and its feed`, () => {
      const home = page(`${id}-index`);
      expect(detectForumIndex(home.html)?.id).toBe(id);
      expect(
        forumPrograms
          .filter((other) => other.detect(home.html) || other.detectIndex?.(home.html))
          .map((other) => other.id),
      ).toEqual([id]);
      expect(forumFeedFrom(home.html, home.url)?.feedUrl ?? null).toBe(feed);
    });
  }

  for (const [name, feedName] of [
    ["nofeedparser-vanilla-index", "nofeedparser-vanilla-feed.xml"],
    ["nofeedparser-mumsnet-index", "nofeedparser-mumsnet-feed.xml"],
  ] as const) {
    it(`names the feed of ${name}, a home page no program knows`, () => {
      const home = page(name);
      expect(forumFeedFrom(home.html, home.url)).toEqual({
        program: null,
        feedUrl: manifest[feedName]?.url,
      });
    });
  }

  it("passes over a comments feed, and gives nothing when it is the only one", () => {
    const onlyComments =
      '<html><head><link rel="alternate" type="application/rss+xml" href="/comments/feed/"></head></html>';
    expect(forumFeedFrom(onlyComments, "https://f.example/")).toBeNull();
    const withForum =
      '<html><head><link rel="alternate" type="application/rss+xml" href="/comments/feed/"><link rel="alternate" type="application/rss+xml" href="/discussions/feed.rss"></head></html>';
    expect(forumFeedFrom(withForum, "https://f.example/")).toEqual({
      program: null,
      feedUrl: "https://f.example/discussions/feed.rss",
    });
  });

  it("passes over a feed on another host, and takes one on the same site", () => {
    const magazine =
      '<html><head><link rel="alternate" type="application/rss+xml" href="https://www.finewoodworking.com/feed"></head></html>';
    expect(forumFeedFrom(magazine, "https://forums.finewoodworking.com/")).toBeNull();
    expect(forumFeedFrom(magazine, "https://finewoodworking.com/")).toEqual({
      program: null,
      feedUrl: "https://www.finewoodworking.com/feed",
    });
  });

  it("takes Discourse's newest topics from its root", () => {
    const head = page("discourse-section");
    expect(forumFeedFrom(head.html, head.url)?.feedUrl).toBe(
      "https://meta.discourse.org/latest.json?order=created",
    );
  });

  it("takes Discourse's newest topics from the folder it lives in", () => {
    const head = page("discourse-folder-index");
    expect(detectForumIndex(head.html)?.id).toBe("discourse");
    expect(forumFeedFrom(head.html, head.url)?.feedUrl).toBe(
      "https://www.sitepoint.com/community/latest.json?order=created",
    );
    // The address comes from the page, not from the one it was read at.
    expect(
      discourse.feedUrl?.(head.html, "https://www.sitepoint.com/community/c/javascript/5"),
    ).toBe("https://www.sitepoint.com/community/latest.json?order=created");
  });

  // BUG-483: home pages with no section rows, which name their version.
  for (const [name, id, feed] of [
    [
      "vbulletin3-index",
      "vbulletin4",
      "https://www.acousticguitarforum.com/forums/external.php?type=RSS2",
    ],
    [
      "vbulletin5-widgets-index",
      "vbulletin5",
      "https://pitmaster.amazingribs.com/external?type=rss2",
    ],
  ] as const) {
    it(`names ${id} from ${name}, and its feed`, () => {
      const home = page(name);
      expect(
        forumPrograms
          .filter((other) => other.detect(home.html) || other.detectIndex?.(home.html))
          .map((other) => other.id),
      ).toEqual([id]);
      expect(forumFeedFrom(home.html, home.url)?.feedUrl).toBe(feed);
    });
  }

  it("never takes another program's list or thread for its home page", () => {
    for (const program of forumPrograms) {
      for (const kind of ["list", "thread"]) {
        const html = page(`${program.id}-${kind}`).html;
        const others = forumPrograms.filter(
          (other) => other !== program && other.detectIndex?.(html),
        );
        expect(others.map((other) => other.id)).toEqual([]);
      }
    }
  });

  it("builds the usual address beside the home page when the page names none", () => {
    expect(xenforo2.feedUrl?.("<html></html>", "https://example.com/community/")).toBe(
      "https://example.com/community/forums/-/index.rss",
    );
    expect(xenforo2.feedUrl?.("<html></html>", "https://example.com/forums/")).toBe(
      "https://example.com/forums/-/index.rss",
    );
    expect(forumFolder("https://example.com/board/index.php?sid=1")).toBe(
      "https://example.com/board/",
    );
  });
});

describe("reading a feed", () => {
  // Items in each captured feed: the feed's own length, set by the forum.
  const counts: Record<string, number> = {
    xenforo2: 50,
    xenforo1: 50,
    phpbb3: 10,
    vbulletin5: 30,
    vbulletin4: 15,
    smf2: 5,
    bbpress: 10,
    mybb: 15,
  };

  for (const [id, count] of Object.entries(counts)) {
    it(`reads every item of ${id}'s feed, each on the forum's host, with a title and a time`, () => {
      const feed = manifest[`${id}-feed.xml`];
      const items = readFeed(
        readFileSync(new URL(`./fixtures/${id}-feed.xml`, import.meta.url), "utf8"),
        feed?.url ?? "",
      );
      expect(items).toHaveLength(count);
      const host = new URL(feed?.url ?? "").hostname;
      for (const item of items ?? []) {
        expect(new URL(item.url).hostname).toBe(host);
        expect(item.title).not.toBe("");
        expect(item.publishedAt).toBeInstanceOf(Date);
        expect(item.text).not.toBe("");
      }
    });
  }

  it("knows each feed's program by its address", () => {
    for (const id of Object.keys(counts)) {
      // XenForo 1 and 2 write one address; the reading is the same.
      expect(feedProgramFor(manifest[`${id}-feed.xml`]?.url ?? "")?.id).toBe(
        id === "xenforo1" ? "xenforo2" : id,
      );
    }
  });

  it("reads a feed a browser showed, and opens a thread rather than its newest post", () => {
    // Bright Data answered WebHostingTalk's feed with Chrome's XML viewer.
    const feed = manifest["vbulletin4-feed.xml"];
    const items = readFeed(
      readFileSync(new URL("./fixtures/vbulletin4-feed.xml", import.meta.url), "utf8"),
      feed?.url ?? "",
    );
    expect(items?.[0]?.url).toBe("https://www.webhostingtalk.com/showthread.php?t=1965154");
  });

  it("reads a feed a browser showed as text, escaped inside a <pre>", () => {
    // Bright Data answered Long Range Hunting's feed this way on 2026-10-31,
    // the same feed it had answered as it is a minute before.
    const feed = manifest["mybb-feed.xml"];
    const xml = readFileSync(new URL("./fixtures/mybb-feed.xml", import.meta.url), "utf8");
    const escaped = xml.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const shown = `<html><head><meta name="color-scheme" content="light dark"></head><body><pre style="word-wrap: break-word; white-space: pre-wrap;">${escaped}</pre></body></html>`;
    expect(readFeed(shown, feed?.url ?? "")).toEqual(readFeed(xml, feed?.url ?? ""));
  });

  it("reads a XenForo 2 thread on a board without short addresses", () => {
    // The High Road's threads are index.php?threads/<slug>.<id>/; all 20 of a
    // live poll on 2026-10-31 were skipped before this.
    const thread = page("xenforo2-thread");
    const html = thread.html.replace(
      '<link rel="canonical" href="https://forums.macrumors.com/threads/',
      '<link rel="canonical" href="https://forums.macrumors.com/index.php?threads/',
    );
    const read = xenforo2.readThread(html, thread.url);
    expect(read?.id).toBe("2493064");
    expect(read?.url).toBe("https://forums.macrumors.com/index.php?threads/m6-imac.2493064/");
  });

  it("knows XenForo's feed on a board without short addresses", () => {
    const home =
      '<html id="XF"><head><link rel="alternate" type="application/rss+xml" title="RSS" href="/index.php?forums/-/index.rss" /></head></html>';
    expect(xenforo2.feedUrl?.(home, "https://www.thehighroad.org/")).toBe(
      "https://www.thehighroad.org/index.php?forums/-/index.rss",
    );
    expect(feedProgramFor("https://www.thehighroad.org/index.php?forums/-/index.rss")?.id).toBe(
      "xenforo2",
    );
  });

  it("reads a title that mixes CDATA with escaped text, and a post's HTML as text", () => {
    const items = readFeed(
      `<rss version="2.0"><channel><item><title><![CDATA[[IC]]>&#093;<![CDATA[ Keycaps]]></title>
      <link>https://f.example/index.php?topic=1.0</link><pubDate>Thu, 29 Oct 2026 08:44:53 GMT</pubDate>
      <description>&lt;p&gt;Which &lt;b&gt;switches&lt;/b&gt;?&lt;/p&gt;</description></item></channel></rss>`,
      "https://f.example/index.php?action=.xml;type=rss2;sa=news",
    );
    expect(items).toEqual([
      {
        url: "https://f.example/index.php?topic=1.0",
        title: "[IC] Keycaps",
        publishedAt: new Date("2026-10-29T08:44:53.000Z"),
        text: "Which switches ?",
      },
    ]);
  });

  it("says a page is not a feed", () => {
    expect(readFeed(page("xenforo2-list").html, xenforoListUrl)).toBeNull();
  });

  it("knows a reply by its title", () => {
    const item = { url: "https://f.example/t/1", publishedAt: null, text: "" };
    expect(isReply({ ...item, title: "Re: Which mower?" })).toBe(true);
    expect(isReply({ ...item, title: "Reply To: Which mower?" })).toBe(true);
    expect(isReply({ ...item, title: "Which mower? Read replies" })).toBe(false);
  });
});

describe("a newest-threads address keeps the query it came with", () => {
  it("leaves a vBulletin address of words as written", () => {
    expect(
      vbulletin4.newestThreadsUrl("https://www.sawmillcreek.org/forumdisplay.php?4-Power-Tools"),
    ).toBe("https://www.sawmillcreek.org/forumdisplay.php?4-Power-Tools&sort=dateline&order=desc");
  });

  it("replaces a parameter it sets rather than adding it twice", () => {
    expect(withParameters("https://f.example/viewforum.php?f=2&sk=a", { sk: "t", sd: "d" })).toBe(
      "https://f.example/viewforum.php?f=2&sk=t&sd=d",
    );
  });
});

describe("an address with a path in its query", () => {
  it("is kept as written when it carries no session id", () => {
    const list = page("invision4-list");
    expect(
      invision4.listThreads(
        list.html.replaceAll(
          "https://linustechtips.com/topic/",
          "https://linustechtips.com/index.php?/topic/",
        ),
        list.url,
      )[0]?.url,
    ).toBe("https://linustechtips.com/index.php?/topic/1644011-pc-for-cs2/");
  });
});

describe("times counted back in words", () => {
  const now = new Date("2026-10-30T07:00:00.000Z");
  it("adds up every unit", () => {
    expect(fromAgo("15 hours, 9 minutes ago", now)).toEqual(new Date("2026-10-29T15:51:00.000Z"));
    expect(fromAgo("1 day, 2 hours ago", now)).toEqual(new Date("2026-10-29T05:00:00.000Z"));
  });
  it("is null for anything else", () => {
    expect(fromAgo("October 29, 2026 at 3:48 pm", now)).toBeNull();
    expect(fromAgo("just now", now)).toBeNull();
  });
});

describe("dates in English words", () => {
  const now = new Date("2026-10-30T03:00:00.000Z");
  const cases: [string, string | null][] = [
    ["Oct 27, 2026 at 6:35 AM", "2026-10-27T06:35:00.000Z"],
    ["Mar 3, 2011", "2011-03-03T00:00:00.000Z"],
    ["Wed, 25 February 2026, 12:03:37", "2026-02-25T12:03:37.000Z"],
    ["October 28, 2026, 11:02:51 PM", "2026-10-28T23:02:51.000Z"],
    ["<strong>Today</strong> at 08:18:14 AM", "2026-10-30T08:18:14.000Z"],
    ["Yesterday at 9:05 pm", "2026-10-29T21:05:00.000Z"],
    ["Tue 13 Oct '26, 3:46pm", "2026-10-13T15:46:00.000Z"],
    ["Today, 12:37pm", "2026-10-30T12:37:00.000Z"],
    ["2026-10-17, 08:57", "2026-10-17T08:57:00.000Z"],
    ["10-14-2026, 05:51 AM", "2026-10-14T05:51:00.000Z"],
    ["28. Oktober 2026", null],
  ];
  for (const [words, expected] of cases) {
    it(`reads "${words}"`, () => {
      expect(fromEnglishDate(words, now)?.toISOString() ?? null).toBe(expected);
    });
  }
});

describe("the HTML helpers", () => {
  it("decodes named and numbered entities", () => {
    expect(decodeEntities("Tom &amp; Jerry&#039;s &#x2014; &quot;ok&quot;")).toBe(
      'Tom & Jerry\'s — "ok"',
    );
  });

  it("keeps line breaks and drops tags and scripts", () => {
    expect(textOf("<p>One<br/>two</p><script>x()</script><b>three</b>")).toBe("One\ntwo\nthree");
  });
});
