import { defineConfig, devices } from "@playwright/test";

/**
 * Real-browser verification for Prompt Coach's three screens. Every one of the 277 unit tests
 * renders into jsdom; nothing before this config has ever loaded the app in an actual browser
 * (see the task report). `webServer` starts the Vite dev server itself so `npm run test:e2e` is
 * self-contained — nobody has to remember `npm run dev:web` first.
 *
 * Every test drives the app via `?fixture=<scenario>`, `main.tsx`'s one added query parameter, so
 * this suite makes no network call and needs no backend: `FixtureRunClient` replays a canned event
 * log on a timer, same as it does for the jsdom suite.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev:web",
    url: "http://localhost:5173",
    cwd: "../..",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
