import { expect, test } from "@playwright/test";
import { gotoFixture, startRun } from "./helpers.js";

/**
 * The nine checks, each with its own percentage, and never an aggregate (PRODUCT.md: "Groups are
 * headers only. Never an aggregate score that hides which check failed."). `passed` is a single,
 * fully-scored pass -- every check lands with a real band and percent, nothing left pending.
 */
test.describe("the nine checks", () => {
  test.beforeEach(async ({ page }) => {
    await gotoFixture(page, "passed");
    await startRun(page);
    // Terminal banner is the run's own signal that every check has landed -- no fixed sleep.
    await expect(page.locator(".verdict-banner__word")).toHaveText("PASSED", { timeout: 15_000 });
  });

  test("all nine checks render, each with its own percentage", async ({ page }) => {
    const rows = page.locator("section.check-panel li.check-row");
    await expect(rows).toHaveCount(9);

    const percents = page.locator("section.check-panel .band-meter__percent");
    await expect(percents).toHaveCount(9);
    const texts = await percents.allTextContents();
    for (const text of texts) {
      expect(text).toMatch(/^\d+%$/);
    }
  });

  test("no group header shows an aggregate score", async ({ page }) => {
    const groupCounts = page.locator("section.check-panel .check-group-header__count");
    await expect(groupCounts).toHaveCount(3);
    const texts = await groupCounts.allTextContents();
    for (const text of texts) {
      // A count of arrived checks ("5 / 5"), never a percentage or an average.
      expect(text).toMatch(/^\d+\s*\/\s*\d+$/);
      expect(text).not.toMatch(/%/);
    }

    // The panel's own header is likewise a count, never an average (design doc / CheckPanel.tsx).
    await expect(page.locator("section.check-panel .check-panel__summary")).toHaveText(/^\d+\/9 at ≥80$/);
  });
});
