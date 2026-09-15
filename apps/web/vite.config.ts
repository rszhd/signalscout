import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Both ports come from the environment so that two git worktrees can run the
 * product at the same time, each on ports of its own. The defaults are the
 * numbers that were written here before, so a single checkout needs no
 * variable. US-135.
 *
 * The proxy target reads `PORT` — the same variable the API binds — and not a
 * second name. Two names for one port is how a second UI ends up calling the
 * first worktree's API while every number looks right.
 */
const webPort = Number(process.env.WEB_PORT ?? 5173);
const apiPort = Number(process.env.PORT ?? 3000);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: webPort,
    // In development the UI is served by Vite and the API by Fastify. In
    // production one Fastify process serves both, so the UI always calls
    // same-origin `/api/...` and never needs a base URL.
    proxy: {
      "/api": { target: `http://localhost:${apiPort}`, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
