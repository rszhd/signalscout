/**
 * One live X reply fetch, to see what a reply's URL is. US-047.
 *
 * **It stores nothing and it is not a poll.** The question is narrow: X is the
 * one platform whose comment link nobody has pressed, and no X reply has ever
 * been stored, so there is nothing on disk to press. This fetches one thread
 * through the connector — not through a hand-written request — because what
 * has to be checked is the URL the pipeline would produce.
 *
 *     pnpm --filter @intentwatch/core probe:x-reply-link <post url>
 *
 * One credit, about $0.008. Delete it once US-047 closes: a probe kept after
 * its question is answered becomes a script nobody knows the purpose of.
 */
import { createLogger } from "../logger.js";
import { SocialCrawlXSource } from "./providers/socialcrawl/x.js";
import { createSourceRuntime } from "./runtime.js";

const apiKey = process.env.SOCIALCRAWL_API_KEY;

if (!apiKey) {
  console.error("No SOCIALCRAWL_API_KEY.");
  process.exit(1);
}

const postUrl = process.argv[2];

if (!postUrl) {
  console.error("Give a post URL: probe:x-reply-link https://x.com/someone/status/123");
  process.exit(1);
}

const externalId = postUrl.split("/status/")[1]?.split(/[?/]/)[0];

if (!externalId) {
  console.error(`Could not read a status id out of ${postUrl}`);
  process.exit(1);
}

// Print the request, so a wrong answer can be told from a wrong question.
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  console.log(`request: ${String(input)}`);

  const response = await originalFetch(input, init);
  const body = await response.clone().text();

  try {
    const parsed = JSON.parse(body) as { data?: { items?: unknown[]; total?: unknown } };
    raw.push(...(parsed.data?.items ?? []));
    console.log(`answer says total: ${String(parsed.data?.total ?? "(absent)")}`);
  } catch {
    console.log("the answer was not JSON");
  }

  return response;
}) as typeof fetch;

/** Every item the page carried, before the parser judged any of it. */
const raw: unknown[] = [];

const source = new SocialCrawlXSource(
  createSourceRuntime({ logger: createLogger({ level: "warn", name: "probe" }) }),
);

const result = await source.fetchReplies({
  postUrl,
  postExternalId: externalId,
  credentials: { apiKey },
});

console.log(`replies: ${result.replies.length}, credits: ${result.unitsConsumed}`);
console.log(`next: ${result.next.status}, partial: ${result.partial}`);
console.log("");

/**
 * What the parser dropped, and why.
 *
 * BUG-007's open box. The parser now refuses a comment whose `post_id` is not
 * the post asked about, and a refusal that leaves no trace cannot say whether
 * the endpoint returned nothing or returned the wrong thing. Those are
 * different provider behaviours and only one of them is our problem.
 */
console.log(`raw items on the page: ${raw.length}`);

for (const item of raw) {
  const comment = (item as { comment?: Record<string, unknown> }).comment ?? item;
  const record = comment as Record<string, unknown>;
  const belongs = String(record.post_id ?? "");

  console.log(
    `  id ${String(record.id)} post_id ${belongs || "(absent)"} ` +
      `parent_id ${String(record.parent_id ?? "(absent)")} ` +
      `${belongs === externalId ? "— under the post asked for" : "— NOT under it"}`,
  );
  console.log(
    `     ${String(record.text ?? "")
      .replace(/\s+/g, " ")
      .slice(0, 80)}`,
  );
}

console.log("");

for (const reply of result.replies.slice(0, 5)) {
  console.log(`  ${reply.url}`);
  console.log(`     author: ${reply.author ?? "?"}`);
  console.log(`     parent reply: ${reply.parentReplyExternalId ?? "none"}`);
  console.log(`     ${reply.text.replace(/\s+/g, " ").slice(0, 90)}`);
  console.log("");
}
