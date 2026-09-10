import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The admin panel is served by the API at `/admin`, so its assets are built
 * under that base. It calls same-origin `/api/...`, which is what lets it use
 * the session cookie the application already set — no CORS and no second login.
 *
 * In development Vite serves the panel on its own port and proxies `/api` to
 * the API, exactly as `apps/web` does.
 */
export default defineConfig({
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  resolve: {
    // The `@/` alias the shadcn components are written against.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
