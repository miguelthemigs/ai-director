import { expect, test } from "@playwright/test";

/**
 * Reloading on a screen whose path is also a backend prefix.
 *
 * Four of this app's routes share a name with a backend route: `/runs`, `/versions`,
 * `/avatar`, `/compare`. The dev proxy forwarded every request on those paths, and a page
 * reload IS a request on that path — so reloading at `/compare` handed the navigation to
 * Fastify, which answered `GET /compare` with the comparison history, and the browser
 * painted a wall of raw JSON. `/compare` showed it worst because that route returns 200
 * with a body; on `/runs` and `/versions` the same fault was there all along.
 *
 * `vite.config.ts` now bypasses the proxy for requests that accept `text/html`. This test
 * is the guard, and it runs without a backend on purpose: the bypass must be decided by
 * the request's own headers, never by whether something answered upstream.
 */
const SCREEN_PATHS = ["/compare", "/versions", "/runs", "/avatar"];

test.describe("a reload on a screen that shares a backend prefix", () => {
  for (const path of SCREEN_PATHS) {
    test(`${path} serves the app, not JSON`, async ({ page }) => {
      const response = await page.goto(path);

      expect(response?.headers()["content-type"]).toContain("text/html");
      // The app booted: its own shell is present rather than a document whose body is a
      // JSON array.
      await expect(page.locator("#root")).toBeAttached();
      await expect(page.getByRole("link", { name: "Compare" })).toBeVisible();
    });
  }
});
