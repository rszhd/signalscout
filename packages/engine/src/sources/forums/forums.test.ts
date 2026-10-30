import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeEntities, textOf } from "./html.js";
import { detectForum, forumPrograms } from "./index.js";
import { phpbb3 } from "./phpbb3.js";
import { xenforo1 } from "./xenforo1.js";

const manifest = JSON.parse(
  readFileSync(new URL("./fixtures/manifest.json", import.meta.url), "utf8"),
) as Record<string, { url: string }>;
function page(name: string): { html: string; url: string } {
  const file = `${name}.html`;
  const entry = manifest[file];
  if (!entry) throw new Error(`no capture named ${file}`);
  return {
    html: readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8"),
    url: entry.url,
  };
}

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
      lastActivityAt: new Date("2026-10-27T13:35:10.000Z"),
      pinned: false,
    });
  });

  it("reads an older time from its words, with or without the hour", () => {
    // Shown as "Mar 3, 2011": no data-time, no hour.
    expect(threads.find((thread) => thread.id === "2110506")?.startedAt).toEqual(
      new Date("2011-03-03T00:00:00.000Z"),
    );
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
