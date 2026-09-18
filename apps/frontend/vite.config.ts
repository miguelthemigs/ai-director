import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const BACKEND_ORIGIN = "http://localhost:8787";

/**
 * Proxy one backend prefix, but never a browser navigating to it.
 *
 * ── The bug this exists to stop ─────────────────────────────────────────────────────
 * Four of this app's own client-side routes have the same names as four backend prefixes:
 * `/runs`, `/versions`, `/avatar`, `/compare`. A plain proxy entry forwards EVERY request
 * on that path, and a page reload is a request on that path. So reloading the browser at
 * `/compare` sent the navigation itself to Fastify, which answered `GET /compare` — the
 * comparison history — and the browser rendered a wall of raw JSON instead of the app.
 * The app was fine; it was never asked for.
 *
 * `/compare` showed it worst because `GET /compare` returns 200 with a body. On `/runs`
 * and `/versions` the same fault had been quietly present all along, which is why
 * `e2e/helpers.ts` tells its own tests to reach those screens by clicking a tab rather
 * than by navigating, and calls a direct `goto` a 502. That was the bug being routed
 * around rather than fixed.
 *
 * ── How the two are told apart ──────────────────────────────────────────────────────
 * A browser navigating to a page sends `Accept: text/html`. `fetch` and `EventSource` do
 * not. So an HTML request on these paths is the SPA's own route and is handed `index.html`
 * (Vite's history fallback, which then boots the app and lets its router read the path);
 * anything else is an API call and is proxied. Returning a path from `bypass` serves that
 * file; returning `undefined` proxies as normal.
 *
 * This is dev-only. In production the app is static files behind one origin and the
 * question does not arise.
 */
function apiProxy(): ProxyOptions {
  return {
    target: BACKEND_ORIGIN,
    changeOrigin: true,
    bypass(req) {
      return req.headers.accept?.includes("text/html") ? "/index.html" : undefined;
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    // Dev-only proxy: the browser sees one origin, so CORS never enters the picture and
    // `HttpRunClient` can be constructed with `baseUrl: ""` in both dev and production.
    proxy: {
      "/runs": apiProxy(),
      "/versions": apiProxy(),
      // Every backend route prefix has to be listed here by hand. A prefix that is missing
      // does not fail loudly: Vite serves the SPA's own index.html for it, the JSON parse
      // fails, and the UI reports a bare 404 against a route that exists and is running.
      // That is exactly what `/avatar` did when it shipped.
      "/avatar": apiProxy(),
      "/compare": apiProxy(),
    },
  },
});
