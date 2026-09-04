import { createLogger, loadEnv } from "@intentwatch/core";
import { startApi } from "./start.js";

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL, name: "api" });

const handle = await startApi({ env, logger });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    logger.info({ signal }, "shutting down");
    handle.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, "shutdown failed");
        process.exit(1);
      },
    );
  });
}
