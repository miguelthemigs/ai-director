import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const BACKEND_ORIGIN = "http://localhost:8787";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    // Dev-only proxy: the browser sees one origin, so CORS never enters the picture and
    // `HttpRunClient` can be constructed with `baseUrl: ""` in both dev and production.
    proxy: {
      "/runs": BACKEND_ORIGIN,
      "/versions": BACKEND_ORIGIN,
      // Every backend route prefix has to be listed here by hand. A prefix that is missing
      // does not fail loudly: Vite serves the SPA's own index.html for it, the JSON parse
      // fails, and the UI reports a bare 404 against a route that exists and is running.
      // That is exactly what `/avatar` did when it shipped.
      "/avatar": BACKEND_ORIGIN,
    },
  },
});
