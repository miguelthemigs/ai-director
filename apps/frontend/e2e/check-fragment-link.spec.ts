import { expect, test } from "@playwright/test";
import { gotoFixture, startRun } from "./helpers.js";

/**
 * The product's whole premise (PRODUCT.md "Product Purpose"): a score with a path back to the
 * words that caused it. Both directions of the link, driven through the real DOM: clicking a
 * check highlights its quoted fragment in the description, and clicking a fragment selects its
 * check. `passed` gives every check a real quoted span to click.
 */
test("clicking a check highlights its fragment, and clicking a fragment selects its check", async ({ page }) => {
  await gotoFixture(page, "passed");
  await startRun(page);
  await expect(page.locator(".verdict-banner__word")).toHaveText("PASSED", { timeout: 15_000 });

  // --- Check -> fragment -----------------------------------------------------------------
  // `dispatchEvent`, not `.click()`: the `.pass-step__pill` layout defect (see
  // `render-layout.spec.ts`'s dedicated test, `helpers.ts`'s `startRun`, and the task report)
  // covers the entire page, this row included, so any real or forced pointer click lands on the
  // pill instead. Dispatching the "click" DOM event directly is the only way to reach this row.
  const wardrobeRow = page.locator("#check-row-wardrobe .check-row__hit");
  await expect(wardrobeRow).toBeVisible();
  await wardrobeRow.dispatchEvent("click");

  const wardrobeFragment = page.locator('.specimen [data-check-ids~="wardrobe"]');
  await expect(wardrobeFragment.first()).toHaveAttribute("data-selected", "true");

  // A different check's fragment must NOT be marked selected by this click.
  const hairFragment = page.locator('.specimen [data-check-ids~="hair_spec"]');
  await expect(hairFragment.first()).not.toHaveAttribute("data-selected", "true");

  // --- Fragment -> check -------------------------------------------------------------------
  const hairFragmentHit = page.locator('.specimen button.span-mark__hit[data-check-id="hair_spec"]').first();
  await expect(hairFragmentHit).toBeVisible();
  await hairFragmentHit.dispatchEvent("click"); // same pre-existing pointer-interception defect

  const hairRow = page.locator("#check-row-hair_spec");
  await expect(hairRow).toHaveAttribute("aria-selected", "true");
  await expect(hairRow).toHaveAttribute("data-selected", "true");

  // The wardrobe row is no longer the selection -- one shared selection, not two independent ones.
  const wardrobeRowLi = page.locator("#check-row-wardrobe");
  await expect(wardrobeRowLi).toHaveAttribute("aria-selected", "false");

  await expect(hairFragment.first()).toHaveAttribute("data-selected", "true");
});
