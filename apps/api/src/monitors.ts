/**
 * The HTTP side of a monitor: the form's options, the generated queries, and
 * the writes.
 *
 * Every rule these routes enforce lives in `@signalscout/pipeline`. A route is a
 * shape check and a status code, and nothing else. That is not tidiness: the
 * worker reads the same rows, so a rule written here would be a rule one
 * caller obeys, and docs/testing.md is clear about how that ends.
 *
 * Two status codes carry a decision worth reading. A query generation that the
 * model refused answers 422 and one that never reached the model answers 502,
 * because the person's next action differs: the first is about the prompt or
 * the answers, the second is about a key, a network or an outage. And a resume
 * that cannot start answers 409 with the missing credential named, because
 * "check your credentials" is not a sentence anybody can act on.
 */ import { registerCollectionRoutes } from "./monitors/collection.js";
import { registerDetailRoutes } from "./monitors/detail.js";
import { registerFormRoutes } from "./monitors/form.js";
import { registerLifecycleRoutes } from "./monitors/lifecycle.js";
import { createMonitorContext, type MonitorRoutesOptions } from "./monitors/shared.js";
import type { ApiServer } from "./server.js";

export type { MonitorRoutesOptions } from "./monitors/shared.js";

export async function registerMonitorRoutes(
  app: ApiServer,
  options: MonitorRoutesOptions,
): Promise<void> {
  const context = createMonitorContext(options);

  registerFormRoutes(app, context);
  registerCollectionRoutes(app, context);
  registerDetailRoutes(app, context);
  registerLifecycleRoutes(app, context);
}
