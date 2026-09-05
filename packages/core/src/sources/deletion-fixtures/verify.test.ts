/** Correctness-critical: provider errors are not deletions. Captured wire responses. */
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { silentLogger } from "../../worker/testing.js";
import { brightDataReddit } from "../providers/brightdata/reddit.js";
import { scrapeCreatorsReddit } from "../providers/scrapecreators/reddit.js";
import { createSourceRuntime } from "../runtime.js";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`${name}.json`, import.meta.url), "utf8"));
const request = {
  externalId: "t3_1w71bul",
  url: fixture("scrapecreators-canonical").url,
  credentials: { apiKey: "test" },
};
function source(
  definition: typeof brightDataReddit,
  answers: { body: unknown; status?: number }[],
) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const { body, status = 200 } of answers)
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  return {
    connector: definition.create(createSourceRuntime({ fetch, logger: silentLogger })),
    fetch,
  };
}
it("ScrapeCreators verifies the matching canonical post and counts reported credits", async () => {
  const { connector } = source(scrapeCreatorsReddit, [
    { body: fixture("scrapecreators-canonical") },
  ]);
  expect(await connector.verify?.(request)).toEqual({ status: "available", unitsConsumed: 1 });
});
it.each(["available", "removed", "missing"])(
  "ScrapeCreators 404 for %s is uncertain, not deletion",
  async (name) => {
    const { connector } = source(scrapeCreatorsReddit, [
      { body: fixture(`scrapecreators-${name}`), status: 404 },
    ]);
    expect(await connector.verify?.(request)).toEqual({ status: "unknown", unitsConsumed: 0 });
  },
);
it("Bright Data starts one URL check then resumes its snapshot", async () => {
  const { connector, fetch } = source(brightDataReddit, [
    { body: fixture("brightdata-trigger") },
    { body: fixture("brightdata-progress") },
    { body: fixture("brightdata-records") },
  ]);
  const pending = await connector.verify?.(request);
  expect(pending).toMatchObject({
    status: "pending",
    unitsConsumed: 0,
    cursor: fixture("brightdata-trigger").snapshot_id,
  });
  const result = await connector.verify?.({
    ...request,
    cursor: fixture("brightdata-trigger").snapshot_id,
  });
  expect(result).toEqual({ status: "available", unitsConsumed: 2 });
  expect(fetch).toHaveBeenCalledTimes(3);
  const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(body).toEqual([{ url: request.url }]);
});
it("Bright Data identifies an explicit deletion even when the description is localized", async () => {
  const { connector } = source(brightDataReddit, [
    { body: fixture("brightdata-progress") },
    { body: fixture("brightdata-records") },
  ]);
  expect(
    await connector.verify?.({ ...request, externalId: "t3_1iyty7q", cursor: "captured" }),
  ).toEqual({ status: "deleted", unitsConsumed: 2 });
});
it("Bright Data identifies a dead page only for the requested URL", async () => {
  const { connector } = source(brightDataReddit, [
    { body: fixture("brightdata-progress") },
    { body: fixture("brightdata-records") },
  ]);
  expect(
    await connector.verify?.({
      ...request,
      externalId: "t3_zzzzzzzzzz",
      url: "https://www.reddit.com/r/softwaretesting/comments/zzzzzzzzzz/",
      cursor: "captured",
    }),
  ).toEqual({ status: "deleted", unitsConsumed: 2 });
});
it("an unrelated or incomplete snapshot is not evidence of deletion", async () => {
  const { connector } = source(brightDataReddit, [
    { body: fixture("brightdata-progress") },
    { body: fixture("brightdata-records") },
  ]);
  expect(
    await connector.verify?.({
      ...request,
      externalId: "t3_other",
      url: "https://www.reddit.com/comments/other/",
      cursor: "captured",
    }),
  ).toEqual({ status: "unknown", unitsConsumed: 2 });
});
it.each([401, 403, 429, 500])("an HTTP %s response cannot delete content", async (status) => {
  const { connector } = source(scrapeCreatorsReddit, [
    { body: fixture("scrapecreators-missing"), status },
  ]);
  const result = await connector.verify?.(request);
  expect(result).toMatchObject({ status: status === 429 ? "pending" : "unknown" });
});

it.each(["[deleted]", "[removed]"])(
  "handles a simulated ScrapeCreators %s body marker",
  async (marker) => {
    // A mutation of a captured response exercises our branch. This is not a
    // claim that the provider has returned the marker; docs/deletions.md says so.
    const body = { ...fixture("scrapecreators-canonical"), selftext: marker };
    const { connector } = source(scrapeCreatorsReddit, [{ body }]);
    expect(await connector.verify?.(request)).toEqual({ status: "deleted", unitsConsumed: 1 });
  },
);
it("an account deletion alone does not delete an available post", async () => {
  const body = { ...fixture("scrapecreators-canonical"), author: "[deleted]" };
  const { connector } = source(scrapeCreatorsReddit, [{ body }]);
  expect(await connector.verify?.(request)).toEqual({ status: "available", unitsConsumed: 1 });
});
