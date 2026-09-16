/** US-015: bounded live capture, four URLs at ScrapeCreators, three at Bright Data. Costs about $0.02.
 * Run from the repository root with node --env-file=.env and this file.
 * Whole responses are retained, with author identity scrubbed. No key is logged.
 */
import { readFileSync, writeFileSync } from "node:fs";

const capturedPost = JSON.parse(
  readFileSync(
    new URL("../providers/scrapecreators/fixtures/subreddit-posts.json", import.meta.url),
    "utf8",
  ),
).body.posts[0];
const urls = [
  ["canonical", `https://www.reddit.com${capturedPost.permalink}`],
  ["available", "https://www.reddit.com/r/softwaretesting/comments/1w71bul/"],
  ["removed", "https://www.reddit.com/r/CreatorsAdvice/comments/1iyty7q/removed/"],
  ["missing", "https://www.reddit.com/r/softwaretesting/comments/zzzzzzzzzz/"],
];
const commentsOnly = process.argv.includes("--comments");
const manifest = commentsOnly
  ? JSON.parse(readFileSync(new URL("manifest.json", import.meta.url), "utf8"))
  : [];
function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /^(author|author_fullname|user_posted|user_id|user_posted_id|username|user_url|user_avatar|profile_image_url)$/.test(
        key,
      ) &&
      typeof item === "string" &&
      !["[deleted]", "[removed]"].includes(item)
        ? "captured-author"
        : scrub(item),
    ]),
  );
}
async function capture(name, url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
  const body = await response.json();
  writeFileSync(
    new URL(`${name}.json`, import.meta.url),
    `${JSON.stringify(scrub(body), null, 2)}\n`,
  );
  manifest.push({ name, url, status: response.status, capturedAt: new Date().toISOString() });
  writeFileSync(
    new URL("manifest.json", import.meta.url),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    name,
    response.status,
    Array.isArray(body) ? `records=${body.length}` : `credits=${body.credits_charged ?? "unknown"}`,
  );
  return body;
}
const sc = process.env.SCRAPECREATORS_API_KEY;
if (sc)
  for (const [name, url] of urls.filter(([name]) => !commentsOnly || name !== "available"))
    await capture(
      `scrapecreators-${commentsOnly ? "comments-" : ""}${name}`,
      `https://api.scrapecreators.com/v1/reddit/post${commentsOnly ? "/comments" : ""}?${new URLSearchParams({ url })}`,
      { headers: { "x-api-key": sc } },
    );
const bd = process.env.BRIGHTDATA_API_KEY || process.env.REDDIT_API_KEY;
if (bd && !commentsOnly) {
  const headers = { Authorization: `Bearer ${bd}`, "Content-Type": "application/json" };
  const triggered = await capture(
    "brightdata-trigger",
    "https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_lvz8ah06191smkebj4&include_errors=true",
    {
      method: "POST",
      headers,
      body: JSON.stringify(
        urls.filter(([name]) => name !== "canonical").map(([, url]) => ({ url })),
      ),
    },
  );
  if (!triggered.snapshot_id) throw new Error("No snapshot id");
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 30000));
    const progress = await capture(
      "brightdata-progress",
      `https://api.brightdata.com/datasets/v3/progress/${triggered.snapshot_id}`,
      { headers },
    );
    if (progress.status === "ready") {
      await capture(
        "brightdata-records",
        `https://api.brightdata.com/datasets/v3/snapshot/${triggered.snapshot_id}?format=json`,
        { headers },
      );
      break;
    }
    if (["failed", "canceled"].includes(progress.status)) break;
  }
}
if (!sc && !bd) throw new Error("No provider key in the environment");
