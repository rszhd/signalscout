import { createLogger } from "./logger.js";
import { ScrapeCreatorsRedditSource } from "./sources/providers/scrapecreators/reddit.js";
import { createSourceRuntime } from "./sources/runtime.js";

const runtime = createSourceRuntime({ logger: createLogger({ level: "silent", name: "probe" }) });
const source = new ScrapeCreatorsRedditSource(runtime);

try {
  const answer = await source.validateCredentials({ apiKey: "definitely-not-a-real-key" });
  console.log("answer:", answer);
} catch (error) {
  const e = error as Error & { cause?: Error & { code?: string }; kind?: string };
  console.log("threw:", e.constructor.name, "| kind:", e.kind, "| message:", e.message);
  console.log("cause:", e.cause?.message, e.cause?.code);
}
