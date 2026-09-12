import { expect, test } from "@playwright/test";
import { gotoFixture, startRun } from "./helpers.js";

/**
 * PRODUCT.md, Global Constraints, verbatim: "Maximum three passes. Terminal state is one of
 * `passed`, `improved_still_failing`, `no_improvement`. **The UI must never show a success state
 * for the last two.**" Design doc §6.2 fixes the exact verdict word per status. This is the first
 * time that rule is checked in a real browser rather than jsdom.
 *
 * The banned-word list (from the task brief) is checked against the whole rendered page, not just
 * the verdict banner -- a success word leaking in anywhere (a stray label, a copy bug elsewhere on
 * the screen) would be just as misleading as one in the banner itself.
 */
const BANNED_PATTERN = /complete|success|done|finished|[✓✔]/i;

test.describe("failing terminal states never read as success", () => {
  test("improved_still_failing renders STILL FAILING, never a success word or tick", async ({ page }) => {
    await gotoFixture(page, "improvedStillFailing");
    await startRun(page);

    const word = page.locator(".verdict-banner__word");
    await expect(word).toHaveText("STILL FAILING", { timeout: 15_000 });

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(BANNED_PATTERN);
  });

  test("no_improvement renders NO IMPROVEMENT, never a success word or tick", async ({ page }) => {
    await gotoFixture(page, "noImprovement");
    await startRun(page);

    const word = page.locator(".verdict-banner__word");
    await expect(word).toHaveText("NO IMPROVEMENT", { timeout: 15_000 });

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(BANNED_PATTERN);
  });
});
