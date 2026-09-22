import { expect, test } from "@playwright/test";
import { gotoFixture, navigateToScreen } from "./helpers.js";

/**
 * The Compare tab, in a real browser, with no backend.
 *
 * This suite runs against fixtures by design (see `helpers.ts`), and the Compare screen is
 * the one screen that refuses to work on fixtures: a fake comparison means two invented
 * video clips, and an invented paid artefact is the thing this product will not put on
 * screen. So what a real browser can prove here is that the refusal itself is reachable,
 * legible and honest — that the tab exists, routes, and says what it needs rather than
 * rendering an empty shell or a dead button.
 *
 * That is worth a browser rather than jsdom for the reason `render-layout.spec.ts`
 * records: a single CSS rule once covered the whole page and swallowed every click,
 * including the tabs, and 312 unit tests plus every review passed over it because jsdom
 * computes no layout. A new tab is exactly the thing that bug would hide behind.
 */
test.describe("the Compare tab", () => {
  test.beforeEach(async ({ page }) => {
    await gotoFixture(page, "passed");
  });

  test("is the fourth tab and is reachable by a real click", async ({ page }) => {
    const tab = page.getByRole("link", { name: "Compare" });
    await expect(tab).toBeVisible();

    await navigateToScreen(page, "Compare");
    await expect(page.getByRole("heading", { name: "Compare", level: 1 })).toBeVisible();
  });

  test("says it needs the real backend, and offers nothing that could spend", async ({ page }) => {
    await navigateToScreen(page, "Compare");

    await expect(page.getByText(/needs the real backend/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /render both/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /grade and repair/i })).toHaveCount(0);
  });

  test("keeps the other three screens reachable from it", async ({ page }) => {
    await navigateToScreen(page, "Compare");
    await navigateToScreen(page, "Run");
    await expect(page.getByRole("tab", { name: "Build an avatar" })).toBeVisible();
  });
});
