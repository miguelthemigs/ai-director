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
    },
  },
});
